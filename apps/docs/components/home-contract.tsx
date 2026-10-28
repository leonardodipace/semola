import { CodePre, HoverCode } from "@/components/hover-code";
import { HomeContractTabs } from "@/components/home-contract-tabs";
import {
  clientSample,
  openApiSample,
  routeSample,
  testSample,
} from "@/lib/home-code";

const inlineCodeClass = "font-mono text-[13px] text-fd-foreground";

export function HomeContract() {
  return (
    <HomeContractTabs
      tabs={[
        {
          id: "route",
          file: "server.ts",
          title: "The route is the contract",
          body: (
            <>
              <code className={inlineCodeClass}>defineRoute()</code> validates
              the request at runtime and types the handler. The response schema
              checks what you send back.
            </>
          ),
          code: (
            <CodePre>
              <HoverCode sample={routeSample} />
            </CodePre>
          ),
        },
        {
          id: "client",
          file: "client.ts",
          title: "A typed client, no codegen step",
          body: "Import the route handle and call it. Bodies and responses are typed from the route, so a typo shows up in your editor.",
          code: (
            <CodePre>
              <HoverCode sample={clientSample} />
            </CodePre>
          ),
        },
        {
          id: "openapi",
          file: "openapi.json",
          title: "An OpenAPI document that cannot drift",
          body: (
            <>
              <code className={inlineCodeClass}>api.getOpenApiSpec()</code>{" "}
              builds the spec from the same schemas the route validates with.
            </>
          ),
          code: (
            <CodePre>
              <HoverCode sample={openApiSample} lang="json" />
            </CodePre>
          ),
        },
        {
          id: "test",
          file: "server.test.ts",
          title: "Validation you can test in memory",
          body: (
            <>
              <code className={inlineCodeClass}>api.fetch()</code> runs a
              request through the whole pipeline without opening a port. Bad
              input gets a 400 before your handler runs.
            </>
          ),
          code: (
            <CodePre>
              <HoverCode sample={testSample} />
            </CodePre>
          ),
        },
      ]}
    />
  );
}
