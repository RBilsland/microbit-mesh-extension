/**
 * Native C++ implementation for mesh network packet handling.
 * Builds and parses mesh packets - runs on micro:bit hardware.
 * Simulator uses the TypeScript fallback in mesh.ts.
 */
#include "pxt.h"

using namespace pxt;

namespace mesh {

#define MESH_MAGIC 0x4D
#define HEADER_LENGTH 6
#define MAX_PAYLOAD_LENGTH 13

// Parsed packet state (used after parsePacket)
static uint8_t s_ttl;
static uint16_t s_msgId;
static uint16_t s_srcId;
static uint8_t s_payloadBuf[MAX_PAYLOAD_LENGTH];
static int s_payloadLen;

/**
 * Build a mesh packet buffer from header fields and payload.
 * @param ttl Time-to-live (hop count)
 * @param msgId Message ID
 * @param srcId Source device ID
 * @param payload Payload buffer (max 13 bytes used)
 * @returns New buffer with formatted packet, or NULL on error
 */
//%
Buffer buildPacket(int ttl, int msgId, int srcId, Buffer payload) {
    if (payload == NULL) return NULL;

    int plen = payload->length;
    if (plen > MAX_PAYLOAD_LENGTH) plen = MAX_PAYLOAD_LENGTH;

    int totalLen = HEADER_LENGTH + plen;
    uint8_t buf[HEADER_LENGTH + MAX_PAYLOAD_LENGTH];

    buf[0] = MESH_MAGIC;
    buf[1] = (uint8_t)(ttl & 0xFF);
    buf[2] = (uint8_t)(msgId & 0xFF);
    buf[3] = (uint8_t)((msgId >> 8) & 0xFF);
    buf[4] = (uint8_t)(srcId & 0xFF);
    buf[5] = (uint8_t)((srcId >> 8) & 0xFF);

    for (int i = 0; i < plen; i++)
        buf[HEADER_LENGTH + i] = payload->data[i];

    return mkBuffer(buf, totalLen);
}

/**
 * Parse a received mesh packet. Call getParsed* to retrieve fields.
 * @param raw Raw received buffer
 * @returns 1 if valid mesh packet, 0 otherwise
 */
//%
int parsePacket(Buffer raw) {
    if (raw == NULL || raw->length < HEADER_LENGTH || raw->data[0] != MESH_MAGIC)
        return 0;

    s_ttl = raw->data[1];
    s_msgId = (uint16_t)(raw->data[2] | (raw->data[3] << 8));
    s_srcId = (uint16_t)(raw->data[4] | (raw->data[5] << 8));
    s_payloadLen = raw->length - HEADER_LENGTH;
    if (s_payloadLen < 0) s_payloadLen = 0;
    if (s_payloadLen > MAX_PAYLOAD_LENGTH) s_payloadLen = MAX_PAYLOAD_LENGTH;

    for (int i = 0; i < s_payloadLen; i++)
        s_payloadBuf[i] = raw->data[HEADER_LENGTH + i];

    return 1;
}

/**
 * Get parsed TTL (call after parsePacket returns 1)
 */
//%
int getParsedTtl() {
    return s_ttl;
}

/**
 * Get parsed message ID (call after parsePacket returns 1)
 */
//%
int getParsedMsgId() {
    return s_msgId;
}

/**
 * Get parsed source ID (call after parsePacket returns 1)
 */
//%
int getParsedSrcId() {
    return s_srcId;
}

/**
 * Get parsed payload as buffer (call after parsePacket returns 1)
 */
//%
Buffer getParsedPayload() {
    return mkBuffer(s_payloadBuf, s_payloadLen);
}

} // namespace mesh
