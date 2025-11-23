#include "pxt.h"

using namespace pxt;

namespace myExtension {
    
    // Persistent buffer to hold the most recent packet
    ManagedBuffer lastPacket;
    bool hasNewPacket = false;

    // Internal C++ handler: triggered by the micro:bit DAL when hardware receives data
    void onRadioEvent(Event e) {
        // 1. Pull the data from the hardware buffer immediately
        // This clears the radio queue so it can receive the next one
        lastPacket = uBit.radio.datagram.recv();
        hasNewPacket = true;

        // 2. Notify TypeScript that data is ready
        // We use a custom event ID (e.g., 9000) or just rely on the standard RADIO event
        // Here we rely on the standard listener in TypeScript
    }

    //% block="start raw receiver"
    void startRawReceiver() {
        // Ensure radio is enabled
        uBit.radio.enable();
        
        // Register our custom C++ handler to listen for radio datagrams
        if (EventModel::defaultEventBus) {
            EventModel::defaultEventBus->listen(
                MICROBIT_ID_RADIO, 
                MICROBIT_RADIO_EVT_DATAGRAM, 
                onRadioEvent
            );
        }
    }

    //% block="get last raw packet"
    Buffer getLastRawPacket() {
        if (!hasNewPacket) return mkBuffer(NULL, 0);

        // Convert the C++ ManagedBuffer into a PXT Buffer (TypeScript friendly)
        return mkBuffer(lastPacket.getBytes(), lastPacket.length());
    }
}
