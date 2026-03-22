import { createSolanaRpc } from "@solana/kit";
import { SolansClient } from "@solans/sdk";
import { buildApp } from "./app.ts";

const rpcUrl = process.env.SOLANS_RPC_URL ?? "https://api.devnet.solana.com";
const port = Number(process.env.PORT ?? 8787);

const app = buildApp(SolansClient.fromRpc(createSolanaRpc(rpcUrl)));

app
  .listen({ port, host: "0.0.0.0" })
  .then((addr) => console.log(`SOLANS resolver listening on ${addr} (rpc: ${rpcUrl})`))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
