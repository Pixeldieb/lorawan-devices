const MESSAGE_TYPE_UNKNOWN = "UNKNOWN";
const MESSAGE_TYPE_ALARM = "ALARM";
const MESSAGE_TYPE_USAGE_HOURLY = "USAGE_HOURLY";
const MESSAGE_TYPE_USAGE_DAILY = "USAGE_DAILY";
const MESSAGE_TYPE_USAGE_MONTHLY = "USAGE_MONTHLY";

const MESSAGE_TYPE_LENGTHS = {
  [MESSAGE_TYPE_ALARM]: 14,
  [MESSAGE_TYPE_USAGE_HOURLY]: 48,
  [MESSAGE_TYPE_USAGE_DAILY]: 26,
  [MESSAGE_TYPE_USAGE_MONTHLY]: 26,
};

const USAGE_TYPES = {
  0: MESSAGE_TYPE_USAGE_HOURLY,
  1: MESSAGE_TYPE_USAGE_DAILY,
  2: MESSAGE_TYPE_USAGE_MONTHLY,
};

const DEVICE_NA1 = "NA1";
const DEVICE_ULTRIMIS = "ULTRIMIS";

const FLAGS_ULTRIMIS = {
  0x01: "Tamper",
  0x02: "Low Battery",
  0x04: "Dry",
  0x08: "Absence of flow",
  0x10: "Extreme temperature",
  0x20: "Burst",
  0x40: "Reverse flow",
  0x80: "Leak",
};

// Ongoing flags are as is, stored flags are shifted 12 bits (<< 12)
const FLAGS_NA1 = {
  0x01: "No Flow",
  0x02: "Minimal Flow",
  0x04: "Reverse Flow",
  0x08: "Maximal Flow",
  0x10: "Leak",
  0x20: "Battery Low",
  0x40: "Magnetic Field",
  0x80: "Tamper",
  0x100: "Temperature too low",
  0x200: "Temperature too high",
  0x400: "Battery energy overrun",
};

class BytesMessage {
  constructor(bytes) {
    this.bytesArr = bytes;
    this.cursor = 0;
  }

  pop() {
    return this.bytesArr[this.cursor++];
  }

  popArr(length = 1) {
    const slice = this.bytesArr.slice(this.cursor, this.cursor + length);
    this.cursor += length;
    return slice;
  }

  popInt(length = 1) {
    return this.popArr(length).reduce(
      (acc, val, idx) => acc + val * Math.pow(2, idx * 8),
      0
    );
  }

  popHex(length = 1, reversed = false) {
    let slice = this.popArr(length);
    if (reversed) slice = slice.reverse();
    return slice
      .map((b) => b.toString(16).padStart(2, "0"))
      .reduce((acc, val) => acc + val, "");
  }
}

function getFlags(flags, status) {
  return Object.entries(flags)
    .filter((item) => item[0] & status)
    .map((item) => item[1]);
}

function decodeUplink(input) {
  const message = new BytesMessage(input.bytes);
  const version = message.pop();

  // Output data
  const data = {
    version: version,
    versionExt: version & 0x80 ? message.pop() : null,
    messageLength: input.bytes.length,
    device: version & 0x04 ? DEVICE_NA1 : DEVICE_ULTRIMIS,
    volumeScalePow: version & 0x18,
    encryption: version & 0x20,
  };

  data.messageType =
    version & 0x40
      ? MESSAGE_TYPE_ALARM
      : USAGE_TYPES[version & 0x03] || USAGE_UNKNOWN;

  data.messageLengthCorrect =
    MESSAGE_TYPE_LENGTHS[data.messageType] + (data.versionExt ? 1 : 0) ===
    data.messageLength;

  // Invalid message length or unknown type
  if (!data.messageLengthCorrect || data.messageType === MESSAGE_TYPE_UNKNOWN)
    return { data };

  data.timestamp = message.popInt(4);

  const date = new Date(data.timestamp * 1000);
  data.date = new Date(
    date.getTime() - date.getTimezoneOffset() * 60000
  ).toISOString();

  data.serialNumber = parseInt(message.popHex(4)).toString();

  // Reverse volume
  if (Object.values(USAGE_TYPES).includes(data.messageType))
    data.volumeReverse = message.popInt(4);

  // Flags
  if (data.device === DEVICE_ULTRIMIS) {
    data.flags = {
      month: getFlags(FLAGS_ULTRIMIS, message.pop()),
      day: getFlags(FLAGS_ULTRIMIS, message.pop()),
      ongoing: getFlags(FLAGS_ULTRIMIS, message.pop()),
    };
  } else if (data.device === DEVICE_NA1) {
    const flags = message
      .popArr(3)
      .reverse()
      .reduce((acc, val, idx) => acc | (val << (idx * 8)), 0);

    data.flags = {
      ongoing: getFlags(FLAGS_NA1, flags),
      stored: getFlags(
        Object.entries(FLAGS_NA1).reduce(
          (acc, [flag, label]) => ({ ...acc, [flag << 12]: label }),
          {}
        ),
        flags
      ),
    };
  }

  // Volume
  if (Object.values(USAGE_TYPES).includes(data.messageType)) {
    data.volume = message.popInt(4);
  }

  // Hourly volumes
  if (data.messageType === MESSAGE_TYPE_USAGE_HOURLY) {
    data.volumes = {
      0: data.volume,
    };

    let volume = data.volume;
    for (let i = 1; i < 14; i++) {
      data.volumes[i * 60] = volume = volume - message.popInt(2);
    }
  }

  // CRC
  data.crc = message.popHex(2, true);

  if (input.variables.DEBUG) {
    message.cursor = 0;
    data.messageHex = message.popHex(data.messageLength);
  }

  return { data };
}

function encodeDownlink(input) {
  return {
    bytes: [225, 230, 255, 0],
  };
}
