#include "pxt.h"
#include "MicroBit.h"
using namespace pxt;
namespace mesh {
    //%
    void sendRawPacket(Buffer data) {
        if (!data) return;
        
        // Get the raw pointer and length from the Buffer
        uint8_t *buf = data->data;
        int len = data->length;
        
        // Send directly using the uBit radio datagram
        // This bypasses the MakeCode radio library's limits
        uBit.radio.datagram.send(buf, len);
    }
}
