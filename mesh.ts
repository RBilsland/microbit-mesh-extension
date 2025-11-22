/**
 * Mesh networking for micro:bit with Routing and Discovery
 */
//% color=#0078D7 weight=100 icon="\uf1eb" block="Mesh"
namespace mesh {
    const MAX_TTL = 4;
    const MAX_HISTORY = 20;
    const MAX_PAYLOAD_SIZE = 230; // Slightly reduced for larger header
    const ROUTE_TIMEOUT = 60000; // Routes expire after 60s
    // Define the C++ shim
    //% shim=mesh::sendRawPacket
    function sendRawPacket(data: Buffer): void {
        return;
    }
    interface Route {
        nodeId: number;     // The destination
        nextHop: number;    // Who to send to (immediate neighbor)
        hopCount: number;   // Distance
        lastSeen: number;   // Timestamp
    }
    class MeshNetwork {
        private messageId: number = 0;
        private seenMessages: number[] = [];
        private routes: Route[] = [];
        
        private onStringHandler: (src: number, msg: string) => void;
        private onNumberHandler: (src: number, msg: number) => void;
        private onNodeFoundHandler: (nodeId: number) => void;
        constructor() {
            this.messageId = Math.floor(Math.random() * 65536);
            radio.onReceivedBuffer((buf) => this.onRadioPacket(buf));
        }
        public init(group: number) {
            radio.setGroup(group);
            radio.setTransmitPower(7);
            radio.setTransmitSerialNumber(true);
            // Start background discovery loop
            control.inBackground(() => {
                while (true) {
                    this.discover();
                    // Send Hello every 15-25 seconds to maintain routes
                    basic.pause(15000 + Math.random() * 10000);
                }
            });
        }
        public discover() {
            // Broadcast a Hello packet
            this.sendPacket(0, PacketType.Hello, PayloadType.None, null, null);
        }
        public sendString(msg: string) {
            this.sendPacket(0, PacketType.Data, PayloadType.String, msg, 0);
        }
        public sendNumber(num: number) {
            this.sendPacket(0, PacketType.Data, PayloadType.Number, null, num);
        }
        public sendStringTo(target: number, msg: string) {
            this.sendPacket(target, PacketType.Data, PayloadType.String, msg, 0);
        }
        public sendNumberTo(target: number, num: number) {
            this.sendPacket(target, PacketType.Data, PayloadType.Number, null, num);
        }
        public onStringReceived(handler: (src: number, msg: string) => void) {
            this.onStringHandler = handler;
        }
        public onNumberReceived(handler: (src: number, msg: number) => void) {
            this.onNumberHandler = handler;
        }
        public onNodeFound(handler: (nodeId: number) => void) {
            this.onNodeFoundHandler = handler;
        }
        public getRoutes(): number[] {
            // Clean up old routes first
            const now = input.runningTime();
            this.routes = this.routes.filter(r => now - r.lastSeen < ROUTE_TIMEOUT);
            return this.routes.map(r => r.nodeId);
        }
        private updateRoute(originId: number, nextHop: number, hops: number) {
            if (originId === 0 || originId === control.deviceSerialNumber()) return;
            const now = input.runningTime();
            let route = this.routes.find(r => r.nodeId === originId);
            if (!route) {
                // New route
                this.routes.push({
                    nodeId: originId,
                    nextHop: nextHop,
                    hopCount: hops,
                    lastSeen: now
                });
                // Notify user of new node
                if (this.onNodeFoundHandler) this.onNodeFoundHandler(originId);
            } else {
                // Update existing route if it's better (shorter) or the same path refreshed
                if (hops <= route.hopCount || route.nextHop === nextHop) {
                    route.nextHop = nextHop;
                    route.hopCount = hops;
                    route.lastSeen = now;
                }
            }
        }
        private sendPacket(target: number, type: PacketType, pType: PayloadType, str: string | null, num: number | null) {
            this.messageId = (this.messageId + 1) % 65536;
            const mySerial = control.deviceSerialNumber();
            // Determine Next Hop
            let nextHop = 0; // Broadcast by default
            if (target !== 0) {
                const route = this.routes.find(r => r.nodeId === target);
                if (route) {
                    nextHop = route.nextHop; // Unicast to next hop
                }
                // If no route, we flood (nextHop = 0), but TargetID is set, so others will forward it.
            }
            // Construct Packet
            // Header: Target(4) + Origin(4) + NextHop(4) + MsgID(2) + Flags(1) = 15 bytes.
            
            let payloadLen = 0;
            let strBuf: Buffer = null;
            
            if (pType === PayloadType.String && str) {
                strBuf = control.createBufferFromUTF8(str);
                if (strBuf.length > MAX_PAYLOAD_SIZE) strBuf = strBuf.slice(0, MAX_PAYLOAD_SIZE);
                payloadLen = strBuf.length;
            } else if (pType === PayloadType.Number) {
                payloadLen = 4;
            }
            const buf = control.createBuffer(15 + payloadLen);
            buf.setNumber(NumberFormat.Int32LE, 0, target);
            buf.setNumber(NumberFormat.Int32LE, 4, mySerial); // Origin ID
            buf.setNumber(NumberFormat.Int32LE, 8, nextHop); // Next Hop
            buf.setNumber(NumberFormat.UInt16LE, 12, this.messageId);
            
            let flags = (MAX_TTL & 0x07);
            // Type is 2 bits now (0-3)
            // 00 = Data, 01 = Ack, 10 = Hello, 11 = HelloAck
            // Let's use bits 3-4 for Type
            flags |= ((type & 0x03) << 3);
            // PayloadType: 0=String, 1=Number, 2=None. Bits 5-6.
            flags |= ((pType & 0x03) << 5);
            
            buf.setNumber(NumberFormat.UInt8LE, 14, flags);
            
            if (pType === PayloadType.String && strBuf) {
                buf.write(15, strBuf);
            } else if (pType === PayloadType.Number && num !== null) {
                buf.setNumber(NumberFormat.Int32LE, 15, num);
            }
            // Send using C++ shim
            sendRawPacket(buf);
        }
        private onRadioPacket(buf: Buffer) {
            if (buf.length < 15) return;
            // Physical Layer Info
            const rssi = radio.receivedPacket(RadioPacketProperty.SignalStrength);
            const senderSerial = radio.receivedPacket(RadioPacketProperty.SerialNumber); // Immediate neighbor
            // Packet Info
            const targetId = buf.getNumber(NumberFormat.Int32LE, 0);
            const originId = buf.getNumber(NumberFormat.Int32LE, 4);
            const nextHopId = buf.getNumber(NumberFormat.Int32LE, 8);
            const msgId = buf.getNumber(NumberFormat.UInt16LE, 12);
            const flags = buf.getNumber(NumberFormat.UInt8LE, 14);
            const hopCount = flags & 0x07;
            const type = (flags >> 3) & 0x03;
            const pType = (flags >> 5) & 0x03;
            // 1. Learn Route (from the immediate sender)
            // If I receive a packet from 'Origin' via 'Sender', 
            // I know 'Sender' is 1 hop away, and 'Origin' is (Hops_Traveled + 1) away?
            // Actually, 'hopCount' in packet is TTL (starts at Max, decrements).
            // So Hops_Traveled = MAX_TTL - hopCount.
            // Distance to Origin = (MAX_TTL - hopCount) + 1.
            // Wait, simpler: 'Sender' is my neighbor.
            // If 'Origin' == 'Sender', distance is 1.
            // If 'Origin' != 'Sender', I can reach 'Origin' via 'Sender'.
            this.updateRoute(originId, senderSerial, (MAX_TTL - hopCount) + 1);
            // Also update route to the immediate sender
            this.updateRoute(senderSerial, senderSerial, 1);
            // 2. Deduplication
            const packetHash = originId ^ (msgId << 16); // Use OriginID for hash!
            if (this.isSeen(packetHash)) return;
            this.markSeen(packetHash);
            // 3. Am I the target?
            const mySerial = control.deviceSerialNumber();
            const isBroadcast = (targetId === 0);
            const isForMe = (targetId === mySerial);
            const isNextHop = (nextHopId === mySerial || nextHopId === 0); // 0 means anyone can forward
            if (isBroadcast || isForMe) {
                // Process Payload
                if (type === PacketType.Data) {
                    if (pType === PayloadType.String && this.onStringHandler) {
                        const payloadStr = buf.slice(15).toString();
                        this.onStringHandler(originId, payloadStr);
                    } else if (pType === PayloadType.Number && this.onNumberHandler) {
                        const payloadNum = buf.getNumber(NumberFormat.Int32LE, 15);
                        this.onNumberHandler(originId, payloadNum);
                    }
                    if (isForMe) this.sendAck(originId, msgId);
                } else if (type === PacketType.Hello) {
                    // Reply with HelloAck (Unicast to Origin)
                    this.sendPacket(originId, PacketType.HelloAck, PayloadType.None, null, null);
                } else if (type === PacketType.HelloAck) {
                    // Already handled by updateRoute above
                }
            }
            // 4. Forwarding
            // Forward if: TTL > 0 AND (Broadcast OR (Unicast AND I am the Next Hop))
            // If Unicast and I am NOT the next hop, I drop it (promiscuous listening only for routing updates).
            if (hopCount > 0 && (isBroadcast || (targetId !== mySerial && isNextHop))) {
                // Decrement TTL
                const newFlags = (flags & ~0x07) | ((hopCount - 1) & 0x07);
                buf.setNumber(NumberFormat.UInt8LE, 14, newFlags);
                
                // Update Next Hop for the forwarded packet
                // If I have a route to Target, set NextHop to that route's next hop.
                // Else, set NextHop to 0 (Flood).
                let newNextHop = 0;
                if (targetId !== 0) {
                    const route = this.routes.find(r => r.nodeId === targetId);
                    if (route) newNextHop = route.nextHop;
                }
                buf.setNumber(NumberFormat.Int32LE, 8, newNextHop);
                sendRawPacket(buf);
            }
        }
        private sendAck(target: number, msgId: number) {
             basic.pause(Math.random() * 50 + 10);
             // Send Ack (Data type with Ack flag? No, we have explicit Ack type now)
             // But we need to send the msgId being acked.
             // Let's send it as a Number payload.
             this.sendPacket(target, PacketType.Ack, PayloadType.Number, null, msgId);
        }
        private isSeen(hash: number): boolean {
            return this.seenMessages.indexOf(hash) !== -1;
        }
        private markSeen(hash: number) {
            this.seenMessages.push(hash);
            if (this.seenMessages.length > MAX_HISTORY) {
                this.seenMessages.shift();
            }
        }
    }
    const network = new MeshNetwork();
    //% block="mesh init group %group"
    export function init(group: number) {
        network.init(group);
    }
    //% block="mesh discover nodes"
    export function discoverNodes() {
        network.discover();
    }
    //% block="mesh get known nodes"
    export function getKnownNodes(): number[] {
        return network.getRoutes();
    }
    //% block="on mesh node found"
    //% draggableParameters=reporter
    export function onNodeFound(handler: (nodeId: number) => void) {
        network.onNodeFound(handler);
    }
    //% block="mesh send string %msg"
    export function sendString(msg: string) {
        network.sendString(msg);
    }
    //% block="mesh send number %num"
    export function sendNumber(num: number) {
        network.sendNumber(num);
    }
    //% block="mesh send string to %target %msg"
    export function sendStringTo(target: number, msg: string) {
        network.sendStringTo(target, msg);
    }
    //% block="mesh send number to %target %num"
    export function sendNumberTo(target: number, num: number) {
        network.sendNumberTo(target, num);
    }
    //% block="on mesh string received"
    //% draggableParameters=reporter
    export function onStringReceived(handler: (src: number, msg: string) => void) {
        network.onStringReceived(handler);
    }
    //% block="on mesh number received"
    //% draggableParameters=reporter
    export function onNumberReceived(handler: (src: number, num: number) => void) {
        network.onNumberReceived(handler);
    }
}
