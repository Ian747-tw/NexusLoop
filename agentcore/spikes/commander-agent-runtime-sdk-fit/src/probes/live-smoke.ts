if (process.env.NXL_SDK_SPIKE_LIVE !== "1") {
  console.error("live smoke requires NXL_SDK_SPIKE_LIVE=1")
  process.exit(1)
}

const required = ["NXL_SDK_SPIKE_CANDIDATE", "NXL_SDK_SPIKE_BASE_URL", "NXL_SDK_SPIKE_API_KEY", "NXL_SDK_SPIKE_MODEL"]
for (const key of required) {
  if (!process.env[key]) {
    console.error(`missing ${key}`)
    process.exit(1)
  }
}

console.log(JSON.stringify({
  status: "not_implemented_in_default_validation",
  candidate: process.env.NXL_SDK_SPIKE_CANDIDATE,
  base_url_host: new URL(process.env.NXL_SDK_SPIKE_BASE_URL ?? "http://localhost").host,
  model: process.env.NXL_SDK_SPIKE_MODEL,
  api_key_present: true,
}, null, 2))
