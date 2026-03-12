# Native (C++) MakeCode Extension Investigation

This document summarises findings on creating a native C++ MakeCode extension for the mesh network, with a focus on supporting longer radio packets.

---

## 1. How Native Extensions Work

### Structure

A native extension combines TypeScript (for blocks, simulator, API) with C++ (for device execution):

```
extension/
├── pxt.json
├── mesh.ts          # TypeScript API + block definitions + simulator fallback
├── mesh.cpp         # C++ implementation (runs on micro:bit)
└── shims.d.ts       # Type declarations (auto-generated from .cpp or handwritten)
```

### The Shim Pattern

TypeScript functions are marked with `//% shim=namespace::function_name` to delegate to C++:

**mesh.ts:**
```typescript
//% shim=mesh::sendRaw
export function sendRaw(data: Buffer): void {
    // This runs in the SIMULATOR only
    radio.sendBuffer(data);
}
```

**mesh.cpp:**
```cpp
#include "pxt.h"
using namespace pxt;

namespace mesh {
    //%
    void sendRaw(Buffer data) {
        auto radio = getRadio();  // Access shared radio
        radio->datagram.send(data->data, data->length);
    }
}
```

### Reference Implementations

- **[pxt-banana](https://github.com/carlosperate/pxt-banana)** – Simple C++ extension with shims
- **[pxt-neopixel](https://github.com/Microsoft/pxt-neopixel)** – Depends on pxt-ws2812b (C++ driver)
- **pxt-microbit libs/cpp-test** – Test library for native code

---

## 2. Radio Packet Size Limits

### Where the Limit Comes From

The 19-byte limit in MakeCode is not in pxt-common-packages, but in the DAL/CODAL radio layer:

| Layer | Source | Limit |
|-------|--------|-------|
| **DAL (micro:bit v1)** | `lancaster-university/microbit-dal` | `MICROBIT_RADIO_MAX_PACKET_SIZE = 32` in [MicroBitRadio.h](https://github.com/lancaster-university/microbit-dal/blob/master/inc/drivers/MicroBitRadio.h) |
| **CODAL (micro:bit v2)** | `lancaster-university/codal-nrf52` | `NRF52_RADIO_MAX_PACKET_SIZE = 32` in [NRF52Radio.h](https://github.com/lancaster-university/codal-nrf52/blob/master/inc/NRF52Radio.h) |
| **pxt-common-packages** | `radio.cpp` | Uses `#ifndef MICROBIT_RADIO_MAX_PACKET_SIZE` → defaults to 32 |

The `FrameBuffer` struct in both stacks has:

```cpp
uint8_t payload[MICROBIT_RADIO_MAX_PACKET_SIZE];  // 32 bytes fixed
```

MakeCode’s high-level API then adds headers, leaving about 19 bytes for user payload.

### Hardware Capability

The Nordic nRF51/nRF52 radio supports up to **251 bytes** per packet (254 minus 3 preamble bytes). MicroPython uses this via `radio.config(length=251)` because it uses a different, configurable radio implementation.

---

## 3. Can a Native Extension Increase the Limit?

### Option A: Override `MICROBIT_RADIO_MAX_PACKET_SIZE` via Config

**Feasibility: Low**

pxt.json supports `yotta` config that feeds into the build, e.g.:

```json
"yotta": {
  "config": {
    "microbit-dal": {
      "bluetooth": { "enabled": 0 }
    }
  }
}
```

`MICROBIT_RADIO_MAX_PACKET_SIZE` is a simple `#define 32` in the DAL header, not a config option. The DAL/CODAL build systems do not expose it through yotta config.

Changing it would require:

- Forking microbit-dal and/or codal-nrf52
- Adding a config path for the packet size
- Maintaining compatibility with MakeCode’s build pipeline

### Option B: Bypass DAL/CODAL and Drive the Radio Directly

**Feasibility: Very High Effort**

A C++ extension could:

1. Include Nordic SDK / HAL headers
2. Configure the RADIO peripheral
3. Use a custom packet format and buffer (e.g. 251 bytes)

Challenges:

- **Conflict with existing radio** – DAL/CODAL already own the RADIO peripheral
- **Build integration** – Need correct include paths, libraries, and target (mbdal vs mbcodal)
- **Compatibility** – Standard `radio` blocks would be unusable when this mode is active
- **Maintenance** – Must track Nordic hardware and build changes

### Option C: Native Extension Using Existing Radio API

**Feasibility: Straightforward**

A native extension can call the same radio APIs as the TypeScript radio layer:

```cpp
// In our mesh.cpp - we have access to uBit.radio (DAL) or getRadio() (CODAL)
// Same 32-byte limit applies - we're using the same underlying code
getRadio()->datagram.send(data, len);  // len effectively max 32
```

Benefits:

- Faster mesh logic (parsing, dedup, relay) in C++
- Same packet limit as the current TypeScript implementation
- No changes to DAL/CODAL or build config

---

## 4. Recommended Approach

### Short Term: Native Extension for Performance Only

Add C++ implementations of the mesh logic (parsing, relay, dedup) and keep packet size at **19 bytes (MakeCode) / 13 bytes (mesh payload)**. This improves performance without changing the limit.

### Medium Term: Chunked Messages in TypeScript

Implement chunking: split long messages into multiple 13-byte fragments and reassemble on receive. This stays within the existing radio API, works with the current extension, and needs no C++ changes.

### Long Term: Upstream DAL/CODAL Changes

Propose configurable packet size to Lancaster’s microbit-dal and codal-nrf52:

- Add `config.json` / `yotta` support for packet size
- Use `#ifdef` / conditional compilation
- Allow values up to 251 bytes

This would require coordination with the runtime maintainers and MakeCode.

---

## 5. Proof-of-Concept Native Extension Structure

A minimal native mesh extension could look like this:

```
mesh-native/
├── pxt.json
├── mesh.ts           # Blocks + TS implementation (simulator) + optional C++ shims
├── mesh.cpp          # C++ mesh logic (parse, relay, send)
├── shims.d.ts        # Declarations for C++ functions
└── README.md
```

**pxt.json:**
```json
{
  "name": "mesh",
  "version": "0.1.0",
  "description": "Mesh network with optional native C++ backend",
  "dependencies": { "core": "*", "radio": "*" },
  "files": ["mesh.ts", "mesh.cpp", "shims.d.ts"],
  "supportedTargets": ["microbit"]
}
```

**mesh.cpp** would implement functions such as:

- `mesh_send_packet(buf)` – send raw mesh packet
- `mesh_parse_packet(buf)` – parse and return metadata
- `mesh_should_relay(ttl, msgId, srcId)` – relay decision

TypeScript would handle the high-level API and orchestration.

---

## 6. Summary

| Approach | Increases packet size? | Complexity | Recommendation |
|----------|-------------------------|-----------|----------------|
| Native extension using existing radio | No | Low | Use for performance if needed |
| Config override (yotta) | Likely no | Low | Not supported by current DAL/CODAL |
| Direct nRF radio access | Yes (up to 251) | Very high | Only for advanced, dedicated projects |
| Chunked messages (TS) | Effectively yes | Medium | Best way to support long messages today |
| Upstream DAL/CODAL change | Yes | High (community) | Long-term option if maintainers agree |

A native extension is viable for faster mesh logic but cannot raise the packet limit without either chunking, a custom radio driver, or upstream runtime changes.
