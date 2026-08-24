import { execFileSync } from "node:child_process";
import path from "node:path";

const trackedFiles = execFileSync("git", ["ls-files", "-z"], {
  encoding: "utf8",
}).split("\0").filter(Boolean);

const forbiddenNames = [
  /^\.env(?:\..*)?$/i,
  /^id_(?:rsa|ed25519)$/i,
  /^credentials\.json$/i,
  /^service-account.*\.json$/i,
  /\.(?:key|pem|p8|p12|pfx|jks)$/i,
];

const forbidden = trackedFiles.filter((file) => {
  const basename = path.posix.basename(file.replaceAll("\\", "/"));
  return forbiddenNames.some((pattern) => pattern.test(basename));
});

if (forbidden.length > 0) {
  console.error("Repository safety check failed. Remove these secret-bearing files from Git:");
  for (const file of forbidden) console.error(`- ${file}`);
  process.exit(1);
}

console.log(`Repository safety check passed (${trackedFiles.length} tracked files inspected).`);
