# Implementing a Custom nRF Radio Driver for 251-byte Packets

This document outlines what it would take to implement a custom Nordic nRF radio driver in C++ to support packets up to 251 bytes (like MicroPython), bypassing the CODAL/DAL 32-byte limit.

---

## 1. The Hardware: nRF52 RADIO Peripheral

The nRF52833 (micro:bit v2) has a flexible 2.4 GHz RADIO peripheral that supports:

- **Nordic proprietary mode** (1 Mbps or 2 Mbps) – same mode used by micro:bit radio
- **Packet structure**: PREAMBLE, ADDRESS (4–5 bytes), S0 (optional 1 byte), LENGTH (1 byte), S1 (optional 1 byte), PAYLOAD, CRC
- **Maximum payload**: 254 bytes minus S0/LENGTH/S1 = **251 bytes** for user data

The key register for packet size is **PCNF1**:

```cpp
// From codal-nrf52 NRF52Radio.cpp line 306:
NRF_RADIO->PCNF1 = 0x02040000 | NRF52_RADIO_MAX_PACKET_SIZE;  // 32
```

Changing `NRF52_RADIO_MAX_PACKET_SIZE` to 251 would allow longer packets at the hardware level.

---

## 2. The Conflict: Shared Resource

The nRF RADIO peripheral is a **single, shared resource**. The micro:bit runtime (CODAL) already:

1. Initialises the RADIO in `NRF52Radio::enable()`
2. Uses it for standard radio (send/receive)
3. Holds pointers to receive buffers (`rxBuf`, `rxQueue`)

You **cannot** run two independent radio implementations at once. Options:

| Approach | Description |
|----------|-------------|
| **A. Fork & modify CODAL** | Change `NRF52_RADIO_MAX_PACKET_SIZE` to 251 in codal-nrf52, update `FrameBuffer` struct, rebuild. Requires maintaining a custom CODAL fork. |
| **B. Replace at init** | Your extension's C++ runs before or instead of the standard radio init. You "take over" the RADIO and the built-in `radio` namespace becomes unusable. |
| **C. Timeslot / coexistence** | Nordic provides a timeslot API for sharing RADIO with BLE. Very complex; not typically used for simple packet radio. |

---

## 3. Approach A: Fork codal-nrf52 (Most Practical)

### Steps

1. **Fork** [lancaster-university/codal-nrf52](https://github.com/lancaster-university/codal-nrf52)

2. **Modify** `inc/NRF52Radio.h`:
   ```cpp
   - #define NRF52_RADIO_MAX_PACKET_SIZE 32
   + #define NRF52_RADIO_MAX_PACKET_SIZE 251
   ```

3. **Update** `FrameBuffer` struct – the payload array is fixed size:
   ```cpp
   uint8_t payload[NRF52_RADIO_MAX_PACKET_SIZE];  // Now 251 bytes
   ```

4. **Memory impact**: Each `FrameBuffer` is heap-allocated. 251-byte payload + header (~260 bytes) × 4 RX buffers ≈ **1 KB+** per device. The micro:bit v2 has 128 KB RAM; this is feasible but uses more memory.

5. **Point MakeCode at your fork**: The micro:bit build pulls codal-nrf52 as a dependency. You'd need to:
   - Publish your fork (e.g. `RBilsland/codal-nrf52`)
   - Configure the pxt-microbit build (or MakeCode's compile service) to use your fork instead of lancaster-university's
   - This likely requires running a **local MakeCode build** or a custom compile pipeline; the cloud compile service uses fixed dependencies

### Challenge

MakeCode's **cloud compile service** uses predetermined versions of codal-microbit-v2, codal-nrf52, etc. You cannot plug in your own fork via a simple extension. You would need to:

- Run **pxt-microbit** locally and override the codal-nrf52 dependency to your fork, or
- Host your own compile service, or
- Propose the change upstream to Lancaster University for inclusion in the official codal-nrf52

---

## 4. Approach B: Standalone Custom Driver (High Effort)

Implement a second radio driver that does **not** use the existing CODAL radio, and operates in a mutually exclusive way.

### Components

1. **Direct register access**:
   ```cpp
   #include "nrf.h"  // Nordic MDK
   // Or use nrfx headers from the nrf52 SDK
   ```

2. **Initialisation sequence** (simplified):
   - Enable HFCLK
   - `NRF_RADIO->MODE = RADIO_MODE_MODE_Nrf_1Mbit`
   - `NRF_RADIO->PCNF0 = ...` and `NRF_RADIO->PCNF1 = ...` (packet config, max length 251)
   - `NRF_RADIO->BASE0`, `NRF_RADIO->PREFIX0` (address/group)
   - `NRF_RADIO->CRCCNF`, `NRF_RADIO->CRCINIT`, `NRF_RADIO->CRCPOLY`
   - `NRF_RADIO->DATAWHITEIV`
   - `NVIC_EnableIRQ(RADIO_IRQn)`

3. **Packet format**: Must match what the hardware expects. The nRF packet layout includes:
   - Length byte (included in the 254)
   - S0, LENGTH, S1 if used
   - Payload
   - CRC (handled by hardware)

4. **Interrupt handler** `RADIO_IRQHandler`: The CODAL radio already defines this. You cannot register a second handler. You would need to:
   - Disable or bypass the CODAL radio when your driver is active, and
   - Either replace the global `RADIO_IRQHandler` or have a single handler that dispatches to your code when your driver "owns" the radio

### Integration with MakeCode

- Your extension would need to **disable** the standard radio (`radio.off()`) when initialising your custom driver
- The built-in `radio` namespace would not work while your driver is active
- Your mesh extension would call your C++ API instead of `radio.sendBuffer` / `radio.onReceivedBuffer`

### Build dependencies

- Access to `nrf.h` or nrfx – usually provided by the codal-nrf52 / nRF5 SDK in the build
- Your C++ would live in the extension and be compiled with the rest of the pxtapp

---

## 5. Approach C: Upstream Change (Best Long-term)

Propose a **configurable** packet size to Lancaster University's codal-nrf52:

1. Add a `config()` or `setMaxPacketLength(len)` API
2. Use `#if` or a config constant so the default stays 32 for compatibility
3. Allow 32–251 when configured

If accepted, MakeCode could expose this (e.g. `radio.config(length=251)`) and your mesh extension could use it without a fork.

---

## 6. Effort Summary

| Approach | Effort | Main blocker |
|----------|--------|--------------|
| **A. Fork codal-nrf52** | Medium | Cloud compile uses official repos; needs local/custom build |
| **B. Standalone driver** | High | Sharing RADIO/ISR with CODAL; replacing radio at runtime |
| **C. Upstream config** | Medium | Waiting on maintainer review and release |

---

## 7. Minimal Change: Local Build with Forked CODAL

For personal or classroom use, the most straightforward path is:

1. Fork `codal-nrf52` and set `NRF52_RADIO_MAX_PACKET_SIZE = 251`
2. Fork `codal-microbit-v2` and change its codal-nrf52 dependency to your fork
3. Use **pxt-microbit** locally: `pxt serve` and point the target at your codal-microbit-v2 fork
4. Build and flash from your local editor

Your mesh extension would then work with 251-byte packets because the underlying CODAL radio would support them. No changes needed in the mesh extension itself; `radio.sendBuffer()` would accept larger buffers once the runtime is rebuilt with the modified CODAL.

---

## References

- [Nordic nRF52833 Product Spec](https://infocenter.nordicsemi.com/pdf/nRF52833_PS_v1.3.pdf) – RADIO chapter
- [codal-nrf52 NRF52Radio.cpp](https://github.com/lancaster-university/codal-nrf52/blob/master/source/NRF52Radio.cpp)
- [MicroPython radio.config(length=251)](https://microbit-micropython.readthedocs.io/en/latest/radio.html#radio.config)
