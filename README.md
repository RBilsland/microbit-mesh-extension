# Mesh Network for micro:bit

A simple MakeCode extension that creates a relay mesh network between micro:bits, extending message range by passing messages through intermediate devices.

## Features

- **Relay messages** – Messages are automatically forwarded by micro:bits in range, extending coverage beyond direct radio range
- **Blocks & Python** – Use in MakeCode Blocks or MakeCode Python (switch editor language as usual)
- **Simple API** – Send and receive messages just like radio, with mesh relay built in

## Installation

1. Open [MakeCode for micro:bit](https://makecode.microbit.org)
2. Click **Extensions** (or **Add Package**)
3. Paste this GitHub URL:  
   `https://github.com/YOUR_USERNAME/microbit-mesh-extension`
4. Click the search result to add the extension

Replace `YOUR_USERNAME` with your GitHub username once you've pushed the repo. Or add via **Extensions** → search for "mesh" (if published to the gallery).

## Usage

### Basic send and receive

```blocks
mesh.setGroup(42)
mesh.onReceived(function (message, signalStrength) {
    basic.showString(message)
})
mesh.sendMessage("hello")
```

### Python (MakeCode Python)

```python
mesh.set_group(42)

def on_received(message, signal_strength):
    basic.show_string(message)

mesh.on_received(on_received)
mesh.send_message("hello")
```

### Configuration

- **mesh set group** – All micro:bits must use the same group (0–255) to communicate
- **mesh set max hops** – How many times a message can be relayed (default 3). Higher = longer range, more traffic
- **mesh set relay** – Turn off relaying on leaf nodes to save power
- **mesh set transmit power** – Radio power 0–7 (advanced)

## How it works

1. When you send a message, it’s wrapped with mesh headers (TTL, message ID, source)
2. Nearby micro:bits receive it
3. If relay is enabled and TTL &gt; 0, they forward it with TTL decreased
4. Duplicate messages are filtered using message IDs
5. Your handler runs when a new message arrives (including relayed ones)

## Limits

- **Message length**: 13 characters (MakeCode radio has a fixed 19-byte packet limit; the longer 251-byte limit in [MicroPython's radio.config()](https://microbit-micropython.readthedocs.io/en/latest/radio.html#radio.config) does not apply to MakeCode)
- **Note**: Cannot be used with the Bluetooth extension (radio and Bluetooth share hardware)

## Native C++ Extension

This extension includes optional native C++ code (`mesh.cpp`) for packet building and parsing. On the micro:bit hardware, these run in C++ for better performance; in the MakeCode simulator, the TypeScript implementation is used.

To build and flash, add this extension to a MakeCode project and download the hex. The C++ is compiled automatically as part of the build.

## License

MIT
