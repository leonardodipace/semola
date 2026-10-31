import { HoverCode } from "@/components/hover-code";
import { HomeComposer } from "@/components/home-composer";
import { composerBase, composerModules } from "@/lib/home-composer-data";

const plain = (code: string) => <HoverCode sample={{ code, hovers: [] }} />;

const countLines = (code: string) => {
  if (!code) return 0;

  return code.replace(/\n$/, "").split("\n").length;
};

export function HomeBuild() {
  const typeModules = composerModules.flatMap((item) => {
    if (!item.typeDef) return [];
    if (!item.typeName) return [];

    return [{ typeName: item.typeName, typeDef: item.typeDef }];
  });

  const typeFileEntries = Array.from(
    { length: (1 << typeModules.length) - 1 },
    (_, index) => {
      const mask = index + 1;
      const selected = typeModules
        .filter((_, bit) => mask & (1 << bit))
        .slice()
        .sort((left, right) => left.typeName.localeCompare(right.typeName));
      const key = selected.map((item) => item.typeName).join("|");
      const code = selected.map((item) => item.typeDef).join("\n\n");

      return { key, code };
    },
  );

  const typeFileNodes = Object.fromEntries(
    typeFileEntries.map((entry) => [entry.key, plain(entry.code)]),
  );

  const typeFileLines = Object.fromEntries(
    typeFileEntries.map((entry) => [entry.key, countLines(entry.code)]),
  );

  const importNodes = Object.fromEntries(
    composerModules.map((item) => [item.id, plain(item.import)]),
  );

  const fileNodes = Object.fromEntries(
    composerModules.map((item) => [
      item.id,
      item.file ? (
        <HoverCode
          key={`${item.id}-file`}
          sample={{
            code: item.file.code,
            hovers: item.id === "schema" ? item.hovers : [],
          }}
        />
      ) : null,
    ]),
  );

  const routeNodes = Object.fromEntries(
    composerModules.map((item) => [
      item.id,
      item.route ? (
        <HoverCode
          key={`${item.id}-route`}
          sample={{ code: item.route, hovers: [] }}
        />
      ) : null,
    ]),
  );

  const stepNodes = Object.fromEntries(
    composerModules.map((item) => [
      item.id,
      item.step ? (
        <HoverCode
          key={`${item.id}-step`}
          sample={{ code: item.step, hovers: item.hovers }}
        />
      ) : null,
    ]),
  );

  const modules = composerModules.map((item) => ({
    id: item.id,
    label: item.label,
    typeName: item.typeName ?? "",
    fileName: item.file?.name ?? "",
    fileLines: item.file ? countLines(item.file.code) : 0,
    hasRoute: Boolean(item.route),
    hasStep: Boolean(item.step),
    lines:
      countLines(item.import) +
      countLines(item.route) +
      countLines(item.step),
  }));

  const baseLines =
    countLines(composerBase.import) +
    countLines(composerBase.start) +
    countLines(composerBase.handler) +
    countLines(composerBase.end);

  return (
    <HomeComposer
      baseImport={plain(composerBase.import)}
      baseStart={plain(composerBase.start)}
      baseHandler={plain(composerBase.handler)}
      baseEnd={plain(composerBase.end)}
      baseLines={baseLines}
      modules={modules}
      importNodes={importNodes}
      typeFileNodes={typeFileNodes}
      typeFileLines={typeFileLines}
      fileNodes={fileNodes}
      routeNodes={routeNodes}
      stepNodes={stepNodes}
    />
  );
}
