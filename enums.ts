namespace mesh {
    export enum PacketType {
        Data = 0,
        Ack = 1,
        Hello = 2,    // Discovery Request
        HelloAck = 3  // Discovery Reply
    }
    export enum PayloadType {
        String = 0,
        Number = 1,
        None = 2
    }
}
