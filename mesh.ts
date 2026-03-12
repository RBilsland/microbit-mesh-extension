/**
 * Mesh Network for micro:bit
 * Extends radio range by relaying messages through intermediate devices
 *
 * Note: MakeCode radio has a fixed 19-byte limit per packet (not configurable like
 * MicroPython's radio.config(length=251)). We use binary format for max payload.
 *
 * Uses native C++ for packet build/parse on device; TypeScript fallback in simulator.
 */
//% weight=95 icon="\uf0ac" color=#E3008C
namespace mesh {

    const MESH_MAGIC = 0x4D;  // 'M'
    const HEADER_LENGTH = 6;   // magic + ttl + msgId(2) + srcId(2)
    const MAX_BUFFER_LENGTH = 19;  // MakeCode radio limit for sendBuffer
    const MAX_PAYLOAD_LENGTH = MAX_BUFFER_LENGTH - HEADER_LENGTH;  // 13 bytes

    let maxHops: number = 3;
    let relayEnabled: boolean = true;
    let messageId: number = 0;
    let seenIds: number[] = [];
    let seenPtr: number = 0;
    let onReceivedHandler: (message: string, signalStrength: number) => void = null;
    let initialized: boolean = false;

    function init() {
        if (initialized) return;
        initialized = true;
        radio.onReceivedBuffer(handleReceivedBuffer);
        seenIds = [];
        for (let i = 0; i < 16; i++) seenIds.push(-1);
    }

    function makeSeenKey(msgId: number, srcId: number): number {
        return (msgId << 16) | (srcId & 0xFFFF);
    }

    function wasSeen(key: number): boolean {
        for (let i = 0; i < 16; i++) {
            if (seenIds[i] === key) return true;
        }
        return false;
    }

    function markSeen(key: number) {
        seenIds[seenPtr] = key;
        seenPtr = (seenPtr + 1) % 16;
    }

    /**
     * Build mesh packet (C++ on device, TS in simulator)
     */
    //% shim=mesh::buildPacket
    function buildPacketNative(ttl: number, msgId: number, srcId: number, payload: Buffer): Buffer {
        // Simulator fallback
        const len = Math.min(payload.length, MAX_PAYLOAD_LENGTH);
        const packet = control.createBuffer(HEADER_LENGTH + len);
        packet[0] = MESH_MAGIC;
        packet[1] = ttl & 0xFF;
        packet.setNumber(NumberFormat.UInt16LE, 2, msgId & 0xFFFF);
        packet.setNumber(NumberFormat.UInt16LE, 4, srcId & 0xFFFF);
        packet.write(HEADER_LENGTH, payload.slice(0, len));
        return packet;
    }

    // Simulator state for parsed packet (getters read this when TS runs)
    let _parsedTtl = 0;
    let _parsedMsgId = 0;
    let _parsedSrcId = 0;
    let _parsedPayload: Buffer = null;

    /**
     * Parse mesh packet (C++ on device, TS in simulator)
     */
    //% shim=mesh::parsePacket
    function parsePacketNative(raw: Buffer): number {
        // Simulator fallback - store in module vars for getters
        if (!raw || raw.length < HEADER_LENGTH || raw[0] !== MESH_MAGIC) return 0;
        _parsedTtl = raw[1];
        _parsedMsgId = raw.getNumber(NumberFormat.UInt16LE, 2);
        _parsedSrcId = raw.getNumber(NumberFormat.UInt16LE, 4);
        _parsedPayload = raw.slice(HEADER_LENGTH);
        return 1;
    }

    //% shim=mesh::getParsedTtl
    function getParsedTtlNative(): number { return _parsedTtl; }
    //% shim=mesh::getParsedMsgId
    function getParsedMsgIdNative(): number { return _parsedMsgId; }
    //% shim=mesh::getParsedSrcId
    function getParsedSrcIdNative(): number { return _parsedSrcId; }
    //% shim=mesh::getParsedPayload
    function getParsedPayloadNative(): Buffer { return _parsedPayload; }

    function parseMeshPacket(buf: Buffer): { ttl: number, msgId: number, srcId: number, payload: string } {
        if (parsePacketNative(buf) !== 1) return null;
        const ttl = getParsedTtlNative();
        const msgId = getParsedMsgIdNative();
        const srcId = getParsedSrcIdNative();
        const payloadBuf = getParsedPayloadNative();
        let payload = "";
        if (payloadBuf) {
            try { payload = payloadBuf.toString(); } catch (e) { }
        }
        return { ttl, msgId, srcId, payload };
    }

    function buildMeshPacket(ttl: number, msgId: number, srcId: number, payload: string): Buffer {
        const buf = control.createBufferFromUTF8(payload);
        const len = Math.min(buf.length, MAX_PAYLOAD_LENGTH);
        const payloadBuf = buf.slice(0, len);
        return buildPacketNative(ttl, msgId, srcId, payloadBuf);
    }

    function truncateToPayloadLen(msg: string): string {
        const buf = control.createBufferFromUTF8(msg);
        if (buf.length <= MAX_PAYLOAD_LENGTH) return msg;
        let s = msg;
        while (control.createBufferFromUTF8(s).length > MAX_PAYLOAD_LENGTH) {
            s = s.substr(0, s.length - 1);
        }
        return s;
    }

    function handleReceivedBuffer(raw: Buffer) {
        const pkt = parseMeshPacket(raw);
        if (!pkt) return;

        const myId = control.deviceSerialNumber() & 0xFFFF;
        const key = makeSeenKey(pkt.msgId, pkt.srcId);

        if (pkt.srcId === myId) return;
        if (wasSeen(key)) return;
        markSeen(key);

        if (relayEnabled && pkt.ttl > 0) {
            const fwd = buildMeshPacket(pkt.ttl - 1, pkt.msgId, pkt.srcId, pkt.payload);
            radio.sendBuffer(fwd);
        }

        const signal = radio.receivedPacket(2);
        if (onReceivedHandler) {
            onReceivedHandler(pkt.payload, signal);
        }
    }

    /**
     * Send a message through the mesh network.
     * Message will be relayed by other micro:bits to extend range (max 13 characters).
     */
    //% block="mesh send message %message"
    //% blockId=mesh_send group="Send" weight=60
    export function sendMessage(message: string) {
        init();
        message = truncateToPayloadLen(message);
        const msgId = messageId;
        messageId = (messageId + 1) & 0xFFFF;
        const srcId = control.deviceSerialNumber() & 0xFFFF;
        const pkt = buildMeshPacket(maxHops, msgId, srcId, message);
        radio.sendBuffer(pkt);
    }

    /**
     * Run code when a mesh message is received (from any device in the network).
     */
    //% block="on mesh received"
    //% blockId=mesh_on_received blockGap=16 group="Receive" weight=55
    //% draggableParameters=reporter
    export function onReceived(handler: (message: string, signalStrength: number) => void) {
        init();
        onReceivedHandler = handler;
    }

    /**
     * Set the radio group (0-255). All micro:bits in the same group can communicate.
     */
    //% block="mesh set group %channel"
    //% blockId=mesh_set_group group="Config" weight=40
    //% channel.min=0 channel.max=255
    export function setGroup(channel: number) {
        init();
        radio.setGroup(Math.max(0, Math.min(255, channel)));
    }

    /**
     * Set maximum number of hops (relays). Higher = longer range, more network traffic.
     * @param hops Max hops (1-9). Default 3.
     */
    //% block="mesh set max hops %hops"
    //% blockId=mesh_set_max_hops group="Config" weight=39
    //% hops.min=1 hops.max=9 hops.defl=3
    export function setMaxHops(hops: number) {
        maxHops = Math.max(1, Math.min(9, hops));
    }

    /**
     * Enable or disable relaying received messages. Disable for leaf nodes to save power.
     */
    //% block="mesh set relay %enabled"
    //% blockId=mesh_set_relay group="Config" weight=38
    export function setRelay(enabled: boolean) {
        relayEnabled = enabled;
    }

    /**
     * Set radio transmit power (0-7). Higher = longer range, more power.
     */
    //% block="mesh set transmit power %power"
    //% blockId=mesh_set_power group="Config" weight=37 advanced=true
    //% power.min=0 power.max=7 power.defl=6
    export function setTransmitPower(power: number) {
        init();
        radio.setTransmitPower(Math.max(0, Math.min(7, power)));
    }
}
