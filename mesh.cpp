#include "pxt.h"

// Ensure we are using the standard micro:bit namespace
using namespace pxt;

namespace myExtension {

    //%
    void sendRawPacket(Buffer data) {
        if (!data) return;

        // 1. Wrap the PXT Buffer in a ManagedBuffer
        // This ensures the memory is treated correctly by the C++ runtime
        ManagedBuffer buf(data);

        // 2. Send using the datagram layer
        // Note: uBit.radio.datagram adds its own small header (approx 4 bytes).
        // If you need truly raw bytes without ANY headers, you might need 
        // uBit.radio.send(buf) instead, but datagram is safer.
        uBit.radio.datagram.send(buf);
    }
}
