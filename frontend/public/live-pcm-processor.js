class LivePcmProcessor extends AudioWorkletProcessor {

  constructor() {
    super();

    this.groupSum = 0;
    this.groupCount = 0;

    this.packet = new Int16Array(512);
    this.packetIndex = 0;
  }

  process(inputs) {

    const input = inputs[0]?.[0];

    if (!input) return true;

    // Convert 48 kHz input into 16 kHz mono audio.
    // Average each group of 3 samples.

    for (let i = 0; i < input.length; i += 1) {

      this.groupSum += input[i];
      this.groupCount += 1;

      if (this.groupCount === 3) {

        const sample = this.groupSum / 3;

        const clipped = Math.max(
          -1,
          Math.min(1, sample)
        );

        this.packet[this.packetIndex] =
          clipped < 0
            ? Math.round(clipped * 32768)
            : Math.round(clipped * 32767);

        this.packetIndex += 1;

        this.groupSum = 0;
        this.groupCount = 0;

        // 512 samples × 2 bytes = 1,024 bytes.
        if (this.packetIndex === 512) {

          const frame = this.packet;

          this.port.postMessage(
            frame.buffer,
            [frame.buffer]
          );

          this.packet = new Int16Array(512);
          this.packetIndex = 0;
        }
      }
    }

    return true;
  }
}

registerProcessor(
  "live-pcm-processor",
  LivePcmProcessor
);