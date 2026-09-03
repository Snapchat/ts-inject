// Single entry point for `npm run bench`. Runs every benchmark in order so the
// full perf picture (lazy classes + general construction/read paths) is captured in one invocation.
import "./lazy-class";
import "./provides-chain";
import "./get-pass";
