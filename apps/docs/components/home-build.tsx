import { HoverCode } from "@/components/hover-code";
import { HomeComposer } from "@/components/home-composer";
import { composerBase, composerModules } from "@/lib/home-code";

const plain = (code: string) => <HoverCode sample={{ code, hovers: [] }} />;

export function HomeBuild() {
  const moduleImports = Object.fromEntries(
    composerModules.map((module) => [module.id, plain(module.import)]),
  );

  const moduleCode = Object.fromEntries(
    composerModules.map((module) => [
      module.id,
      <HoverCode
        key={module.id}
        sample={{ code: module.code, hovers: module.hovers }}
      />,
    ]),
  );

  return (
    <HomeComposer
      baseImport={plain(composerBase.import)}
      baseStart={plain(composerBase.start)}
      baseEnd={plain(composerBase.end)}
      moduleImports={moduleImports}
      moduleCode={moduleCode}
    />
  );
}
