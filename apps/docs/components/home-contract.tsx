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
          title: "One defineRoute. Runtime and types.",
          body: (
            <>
              <code className={inlineCodeClass}>defineRoute()</code> checks the
              request when it arrives and types the handler from the same
              schemas. The response schema is not documentation - it is what
              you are allowed to send back.
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
          title: "A client with no codegen ceremony",
          body: "Import the route handle and call it like a function. Bodies and responses are already typed from the server definition - a typo fails before you hit send.",
          code: (
            <CodePre>
              <HoverCode sample={clientSample} />
            </CodePre>
          ),
        },
        {
          id: "openapi",
          file: "openapi.json",
          title: "OpenAPI that cannot lie about the API",
          body: (
            <>
              <code className={inlineCodeClass}>api.getOpenApiSpec()</code>{" "}
              builds the document from the schemas the route already validates
              with. Change the route, the spec changes - there is no parallel
              YAML to forget.
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
          title: "Full pipeline tests, no open port",
          body: (
            <>
              <code className={inlineCodeClass}>api.fetch()</code> runs a
              Request through middleware, validation, and the handler in
              process. Bad input gets a 400 before your code runs.
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
