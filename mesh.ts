/**
 * Mesh networking for micro:bit
 */
//% color=#0078D7 weight=100 icon="\uf1eb" block="Mesh"
namespace mesh {
    const MAX_TTL = 4;
    const MAX_HISTORY = 20;
    const MAX_PAYLOAD_SIZE = 240; // Now we can send huge packets!
    // Define the C++ shim
    //% shim=mesh::sendRawPacket
    function sendRawPacket(data: Buffer): void {
        // This will be replaced by the C++ implementation
        return;
    }
    class MeshNetwork {
        private messageId: number = 0;
        private seenMessages: number[] = [];
        private onStringHandler: (src: number, msg: string) => void;
        private onNumberHandler: (src: number, msg: number) => void;
        constructor() {
            this.messageId = Math.floor(Math.random() * 65536);
            // Use onReceivedBuffer to catch all packets
            radio.onReceivedBuffer((buf) => this.onRadioPacket(buf));
        }
        public init(group: number) {
            radio.setGroup(group);
            radio.setTransmitPower(7);
            radio.setTransmitSerialNumber(true);
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
        private sendPacket(target: number, type: PacketType, pType: PayloadType, str: string | null, num: number | null) {
            this.messageId = (this.messageId + 1) % 65536;
            
            // Calculate size needed
            let payloadLen = 0;
            let strBuf: Buffer = null;
            
            if (pType === PayloadType.String && str) {
                strBuf = control.createBufferFromUTF8(str);
                // Truncate if absolutely necessary (but we have 240 bytes now!)
                if (strBuf.length > MAX_PAYLOAD_SIZE) {
                    strBuf = strBuf.slice(0, MAX_PAYLOAD_SIZE);
                }
                payloadLen = strBuf.length;
            } else if (pType === PayloadType.Number) {
                payloadLen = 4;
            }
            // Header (7 bytes) + Payload
            const buf = control.createBuffer(7 + payloadLen);
            
            // Header
            buf.setNumber(NumberFormat.Int32LE, 0, target);
            buf.setNumber(NumberFormat.UInt16LE, 4, this.messageId);
            
            let flags = (MAX_TTL & 0x07);
            if (type === PacketType.Ack) flags |= 0x08;
            if (pType === PayloadType.Number) flags |= 0x10;
            buf.setNumber(NumberFormat.UInt8LE, 6, flags);
            // Payload
            if (pType === PayloadType.String && strBuf) {
                buf.write(7, strBuf);
            } else if (pType === PayloadType.Number && num !== null) {
                buf.setNumber(NumberFormat.Int32LE, 7, num);
            }
            // Send using C++ shim
            sendRawPacket(buf);
        }
        private onRadioPacket(buf: Buffer) {
            if (buf.length < 7) return;
            // Extract Header
            const senderId = radio.receivedPacket(RadioPacketProperty.SerialNumber);
            const targetId = buf.getNumber(NumberFormat.Int32LE, 0);
            const msgId = buf.getNumber(NumberFormat.UInt16LE, 4);
            const flags = buf.getNumber(NumberFormat.UInt8LE, 6);
            const hopCount = flags & 0x07;
            const type = (flags & 0x08) ? PacketType.Ack : PacketType.Data;
            const pType = (flags & 0x10) ? PayloadType.Number : PayloadType.String;
            // Deduplication
            const packetHash = senderId ^ (msgId << 16);
            if (this.isSeen(packetHash)) return;
            this.markSeen(packetHash);
            // Processing
            const mySerial = control.deviceSerialNumber();
            const isBroadcast = targetId === 0;
            const isForMe = targetId === mySerial;
            if (isBroadcast || isForMe) {
                if (type === PacketType.Data) {
                    if (pType === PayloadType.String && this.onStringHandler) {
                        // Read string from the rest of the buffer
                        const payloadStr = buf.slice(7).toString();
                        this.onStringHandler(senderId, payloadStr);
                    } else if (pType === PayloadType.Number && this.onNumberHandler) {
                        const payloadNum = buf.getNumber(NumberFormat.Int32LE, 7);
                        this.onNumberHandler(senderId, payloadNum);
                    }
                    if (isForMe) {
                        this.sendAck(senderId, msgId);
                    }
                }
            }
            // Forwarding
            if (hopCount > 0) {
                const newFlags = (flags & ~0x07) | ((hopCount - 1) & 0x07);
                buf.setNumber(NumberFormat.UInt8LE, 6, newFlags);
                sendRawPacket(buf);
            }
        }
        private sendAck(target: number, msgId: number) {
             basic.pause(Math.random() * 50 + 10);
             
             this.messageId = (this.messageId + 1) % 65536;
             
             const buf = control.createBuffer(11); // 7 header + 4 payload
             buf.setNumber(NumberFormat.Int32LE, 0, target);
             buf.setNumber(NumberFormat.UInt16LE, 4, this.messageId);
             
             let flags = (MAX_TTL & 0x07);
             flags |= 0x08; // Ack
             flags |= 0x10; // Number payload
             buf.setNumber(NumberFormat.UInt8LE, 6, flags);
             
             buf.setNumber(NumberFormat.Int32LE, 7, msgId);
             
             sendRawPacket(buf);
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
