#!/usr/bin/env node
// Selects a simulator runtime/device based on simctl JSON.
// Reads JSON from stdin and prints three lines:
// <runtime identifier>\n<device type identifier>\n<existing device UDID>

const collectStdin = async () => {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
};

(async () => {
  try {
    const raw = await collectStdin();
    const data = JSON.parse(raw);
    const runtimes = (data.runtimes || []).filter(
      (rt) =>
        rt.isAvailable &&
        rt.identifier?.startsWith("com.apple.CoreSimulator.SimRuntime.iOS"),
    );
    const byVer = (rt) => (rt.version || "0").split(".").map(Number);
    let runtime = "";
    for (const rt of runtimes) {
      if (rt.name === "iOS 18.5") {
        runtime = rt.identifier;
        break;
      }
    }
    const pickLatest = (arr) =>
      arr
        .slice()
        .sort((a, b) => {
          const av = byVer(a);
          const bv = byVer(b);
          for (let i = 0; i < Math.max(av.length, bv.length); i++) {
            const diff = (av[i] || 0) - (bv[i] || 0);
            if (diff) return diff;
          }
          return 0;
        })
        .slice(-1)[0];
    if (!runtime) {
      const r18 = runtimes.filter((rt) => (rt.version || "").startsWith("18."));
      if (r18.length) runtime = pickLatest(r18).identifier;
      else if (runtimes.length) runtime = pickLatest(runtimes).identifier;
    }
    const devTypes = data.devicetypes || [];
    const deviceType =
      (
        devTypes.find((dt) => dt.name === "iPhone 16 Pro") ||
        devTypes.find((dt) => (dt.name || "").startsWith("iPhone")) ||
        {}
      ).identifier || "";
    let deviceId = "";
    if (runtime && deviceType) {
      const devs = (data.devices?.[runtime] || []).filter(
        (d) => d.isAvailable && d.deviceTypeIdentifier === deviceType,
      );
      if (devs.length) deviceId = devs[0].udid;
    }
    console.log(runtime);
    console.log(deviceType);
    console.log(deviceId);
  } catch (e) {
    console.error("Failed to parse simulator JSON:", e.message);
    process.exit(1);
  }
})();
