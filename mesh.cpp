/**
 * Native C++ implementation for mesh network packet handling.
 * Builds and parses mesh packets - runs on micro:bit hardware.
 * Includes full mesh logic: parse, dedup, relay decision.
 * Simulator uses the TypeScript fallback in mesh.ts.
 */
#include "pxt.h"

using namespace pxt;

namespace mesh {

#define MESH_MAGIC 0x4D
#define HEADER_LENGTH 6
#define MAX_PAYLOAD_LENGTH 13
#define SEEN_SIZE 16

// Parsed packet state (used after parsePacket / processReceived)
static uint8_t s_ttl;
static uint16_t s_msgId;
static uint16_t s_srcId;
static uint8_t s_payloadBuf[MAX_PAYLOAD_LENGTH];
static int s_payloadLen;

// Mesh relay state
static bool s_shouldRelay = false;
static uint8_t s_relayPacket[HEADER_LENGTH + MAX_PAYLOAD_LENGTH];
static int s_relayPacketLen = 0;

// Deduplication
static uint32_t s_seenIds[SEEN_SIZE];
static int s_seenPtr = 0;
static bool s_relayEnabled = true;
static bool s_seenInitialized = false;

static void initSeenIds() {
    if (s_seenInitialized) return;
    for (int i = 0; i < SEEN_SIZE; i++)
        s_seenIds[i] = 0xFFFFFFFF;
    s_seenInitialized = true;
}

static uint32_t makeSeenKey(uint16_t msgId, uint16_t srcId) {
    return ((uint32_t)msgId << 16) | (srcId & 0xFFFF);
}

static bool wasSeen(uint32_t key) {
    for (int i = 0; i < SEEN_SIZE; i++) {
        if (s_seenIds[i] == key) return true;
    }
    return false;
}

static void markSeen(uint32_t key) {
    s_seenIds[s_seenPtr] = key;
    s_seenPtr = (s_seenPtr + 1) % SEEN_SIZE;
}

/**
 * Set whether this node relays received packets.
 */
//%
void setRelayEnabled(bool enabled) {
    s_relayEnabled = enabled;
}

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

/**
 * Process a received mesh packet: parse, dedup, relay decision.
 * Call getParsed* and shouldRelay/getRelayPacket after this returns 1.
 * @param raw Raw received buffer
 * @param myId This device's ID (lower 16 bits of serial number)
 * @returns 1 if packet should be delivered to user, 0 if dropped
 */
//%
int processReceived(Buffer raw, int myId) {
    if (raw == NULL || raw->length < HEADER_LENGTH || raw->data[0] != MESH_MAGIC)
        return 0;

    initSeenIds();

    s_ttl = raw->data[1];
    s_msgId = (uint16_t)(raw->data[2] | (raw->data[3] << 8));
    s_srcId = (uint16_t)(raw->data[4] | (raw->data[5] << 8));
    s_payloadLen = raw->length - HEADER_LENGTH;
    if (s_payloadLen < 0) s_payloadLen = 0;
    if (s_payloadLen > MAX_PAYLOAD_LENGTH) s_payloadLen = MAX_PAYLOAD_LENGTH;

    for (int i = 0; i < s_payloadLen; i++)
        s_payloadBuf[i] = raw->data[HEADER_LENGTH + i];

    // Don't process our own messages (echo)
    if (s_srcId == (uint16_t)(myId & 0xFFFF))
        return 0;

    uint32_t key = makeSeenKey(s_msgId, s_srcId);
    if (wasSeen(key))
        return 0;

    markSeen(key);

    // Relay decision
    s_shouldRelay = false;
    s_relayPacketLen = 0;
    if (s_relayEnabled && s_ttl > 0) {
        s_shouldRelay = true;
        uint8_t newTtl = s_ttl - 1;
        s_relayPacket[0] = MESH_MAGIC;
        s_relayPacket[1] = newTtl;
        s_relayPacket[2] = (uint8_t)(s_msgId & 0xFF);
        s_relayPacket[3] = (uint8_t)((s_msgId >> 8) & 0xFF);
        s_relayPacket[4] = (uint8_t)(s_srcId & 0xFF);
        s_relayPacket[5] = (uint8_t)((s_srcId >> 8) & 0xFF);
        for (int i = 0; i < s_payloadLen; i++)
            s_relayPacket[HEADER_LENGTH + i] = s_payloadBuf[i];
        s_relayPacketLen = HEADER_LENGTH + s_payloadLen;
    }

    return 1;
}

/**
 * Whether the last processed packet should be relayed (call after processReceived returns 1)
 */
//%
bool shouldRelay() {
    return s_shouldRelay;
}

/**
 * Get the relay packet to send (call after processReceived returns 1 and shouldRelay is true)
 */
//%
Buffer getRelayPacket() {
    if (s_relayPacketLen <= 0) return NULL;
    return mkBuffer(s_relayPacket, s_relayPacketLen);
}

} // namespace mesh
