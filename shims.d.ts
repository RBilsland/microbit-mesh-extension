// Declarations for mesh C++ native functions (mesh.cpp).
// Used by PXT to link TypeScript shims to native code.
declare namespace mesh {
    //% shim=mesh::buildPacket
    function buildPacket(ttl: number, msgId: number, srcId: number, payload: Buffer): Buffer;
    //% shim=mesh::parsePacket
    function parsePacket(raw: Buffer): number;
    //% shim=mesh::getParsedTtl
    function getParsedTtl(): number;
    //% shim=mesh::getParsedMsgId
    function getParsedMsgId(): number;
    //% shim=mesh::getParsedSrcId
    function getParsedSrcId(): number;
    //% shim=mesh::getParsedPayload
    function getParsedPayload(): Buffer;
}
