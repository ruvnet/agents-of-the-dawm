#!/usr/bin/env bash
# W3.WORLD.01 — build the WorldGraph browser runtime (ADR 0003) from a PINNED source commit.
#
# 1. Shallow-fetch github.com/ruvnet/worldgraph at WG_COMMIT into .wg-src/ (gitignored).
# 2. Verify the checked-out SHA equals the pin (never builds mutable `main`).
# 3. Optionally run upstream native `cargo test` for the crates the bridge depends on (WG_TEST=1).
# 4. `wasm-pack build --target web --release` of the `worldgraph-wasm` crate into src/wasm/pkg/.
# 5. Write src/wasm/pkg/RECEIPT.json (source commit, wasm sha256, byte sizes, toolchain, license).
#
# Environment:
#   CARGO_TARGET_DIR   defaults to $HOME/.cache/floodline-cargo-target (keeps the repo small)
#   WG_TEST=1          also run upstream cargo tests and record the result in the receipt
#   WORLDGRAPH_WASM_OPT=1  run binaryen wasm-opt (off by default, as upstream: no unpinned download)
set -euo pipefail

WG_REPO="https://github.com/ruvnet/worldgraph"
WG_COMMIT="9b1c79c836cdacfb7b44f058c593157bac4c1dab"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="${ROOT}/.wg-src"
OUT="${ROOT}/src/wasm/pkg"
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-${HOME}/.cache/floodline-cargo-target}"
export PATH="${HOME}/.cargo/bin:${PATH}"
mkdir -p "${CARGO_TARGET_DIR}"

for tool in git cargo rustc wasm-pack sha256sum; do
  command -v "$tool" >/dev/null 2>&1 || { echo "error: $tool not found" >&2; exit 1; }
done

if [[ ! -d "${SRC}/.git" ]]; then
  git init -q "${SRC}"
fi
if [[ "$(git -C "${SRC}" rev-parse HEAD 2>/dev/null || true)" != "${WG_COMMIT}" ]]; then
  echo "-> fetching ${WG_REPO}@${WG_COMMIT} (depth 1)"
  git -C "${SRC}" fetch -q --depth 1 "${WG_REPO}" "${WG_COMMIT}"
  git -C "${SRC}" checkout -q --force FETCH_HEAD
fi
ACTUAL="$(git -C "${SRC}" rev-parse HEAD)"
if [[ "${ACTUAL}" != "${WG_COMMIT}" ]]; then
  echo "error: source SHA ${ACTUAL} != pinned ${WG_COMMIT}" >&2
  exit 1
fi
if [[ -n "$(git -C "${SRC}" status --porcelain)" ]]; then
  echo "error: ${SRC} has local modifications; refusing to build a dirty pin" >&2
  exit 1
fi

CRATE_DIR="${SRC}/worldgraph-wasm"
CRATE_LICENSE="$(sed -n 's/^license *= *"\(.*\)"/\1/p' "${SRC}/Cargo.toml" | head -1)"
CRATE_VERSION="$(sed -n 's/^version *= *"\(.*\)"/\1/p' "${CRATE_DIR}/Cargo.toml" | head -1)"

TEST_RESULT="not-run"
if [[ "${WG_TEST:-0}" == "1" ]]; then
  echo "-> upstream cargo test (worldgraph, geo, worldgraph-stream, worldgraph-wasm)"
  if (cd "${SRC}" && cargo test --locked -q -p wifi-densepose-worldgraph -p wifi-densepose-geo \
        -p worldgraph-stream -p worldgraph-wasm 2>&1 | tee "${CARGO_TARGET_DIR}/wg-cargo-test.log" | grep -E '^test result:'); then
    if grep -q 'FAILED' "${CARGO_TARGET_DIR}/wg-cargo-test.log"; then TEST_RESULT="failed"; else TEST_RESULT="passed"; fi
  else
    TEST_RESULT="failed"
  fi
  echo "   cargo test: ${TEST_RESULT}"
fi

OPT_ARGS=(--no-opt)
if [[ "${WORLDGRAPH_WASM_OPT:-0}" == "1" ]]; then OPT_ARGS=(); fi

echo "-> wasm-pack build --target web --release -> ${OUT}"
rm -rf "${OUT}"
# Host RUSTFLAGS (e.g. -C link-arg=-fuse-ld=mold) are invalid for rust-lld on wasm32: build with none.
(cd "${CRATE_DIR}" && RUSTFLAGS="" CARGO_ENCODED_RUSTFLAGS="" wasm-pack build --release --locked --target web \
   --out-name worldgraph_wasm --out-dir "${OUT}" "${OPT_ARGS[@]}")

# The generated pkg is committed so the game builds without a Rust toolchain.
rm -f "${OUT}/.gitignore"

WASM="${OUT}/worldgraph_wasm_bg.wasm"
[[ -s "${WASM}" ]] || { echo "error: ${WASM} missing" >&2; exit 1; }
WASM_SHA="$(sha256sum "${WASM}" | cut -d' ' -f1)"
JS_SHA="$(sha256sum "${OUT}/worldgraph_wasm.js" | cut -d' ' -f1)"
WASM_BYTES="$(stat -c %s "${WASM}")"
JS_BYTES="$(stat -c %s "${OUT}/worldgraph_wasm.js")"
RUSTC_V="$(rustc --version)"
WASMPACK_V="$(wasm-pack --version)"
# wasm-pack fetches the wasm-bindgen CLI matching the locked crate version.
WASM_BINDGEN_V="$(grep -A1 '^name = "wasm-bindgen"$' "${SRC}/Cargo.lock" | sed -n 's/^version = "\(.*\)"/\1/p' | head -1)"

cat > "${OUT}/RECEIPT.json" <<EOF
{
  "module": "worldgraph-wasm",
  "crate": "worldgraph-wasm",
  "crateVersion": "${CRATE_VERSION}",
  "crateLicense": "${CRATE_LICENSE}",
  "sourceRepo": "${WG_REPO}",
  "sourceCommit": "${ACTUAL}",
  "wasmFile": "worldgraph_wasm_bg.wasm",
  "wasmSha256": "${WASM_SHA}",
  "wasmBytes": ${WASM_BYTES},
  "jsFile": "worldgraph_wasm.js",
  "jsSha256": "${JS_SHA}",
  "jsBytes": ${JS_BYTES},
  "target": "web",
  "profile": "release",
  "wasmOpt": $([[ "${WORLDGRAPH_WASM_OPT:-0}" == "1" ]] && echo true || echo false),
  "rustc": "${RUSTC_V}",
  "rustflags": "",
  "wasmPack": "${WASMPACK_V}",
  "wasmBindgen": "${WASM_BINDGEN_V}",
  "upstreamCargoTest": "${TEST_RESULT}"
}
EOF
echo "OK ${WASM_BYTES} bytes sha256=${WASM_SHA}"
