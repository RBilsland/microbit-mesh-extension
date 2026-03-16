// Declarations for mesh C++ native functions (mesh.cpp).
declare namespace mesh {
    function buildPacket(ttl: number, msgId: number, srcId: number, payload: Buffer): Buffer;
    function parsePacket(raw: Buffer): number;
    function getParsedTtl(): number;
    function getParsedMsgId(): number;
    function getParsedSrcId(): number;
    function getParsedPayload(): Buffer;
    function processReceived(raw: Buffer, myId: number): number;
    function shouldRelay(): boolean;
    function getRelayPacket(): Buffer;
    function setRelayEnabled(enabled: boolean): void;
}
