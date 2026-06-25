import z from "zod";
import { CLI } from "./lib/cli/index.js";

const program = new CLI({
  name: "test",
});

program
  .command("publish")
  .argument("pkg", {
    schema: z.string().min(1).describe("The package to publish"),
  })
  .option("tag", {
    schema: z.string().min(1).describe("The tag to publish the package with"),
    aliases: ["t"],
  })
  .action((args, options) => {
    console.log(`Publishing ${args.pkg} with tag ${options.tag}`);
  });

await program.parse();
