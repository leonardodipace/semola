import { CodePre, HoverCode } from "@/components/hover-code";
import { HomeStoryStage } from "@/components/home-story-stage";
import { describeError, moduleExamples } from "@/lib/home-code";

export function HomeStory() {
  const stories = moduleExamples.map((example) => {
    const error = describeError(example.broken, example.file);

    return {
      pkg: example.pkg,
      label: example.label,
      href: example.href,
      title: example.title,
      body: example.body,
      file: example.file,
      breakLabel: example.breakLabel,
      errorMessage: error.message,
      errorLocation: error.location,
      code: (
        <CodePre>
          <HoverCode sample={example.sample} />
        </CodePre>
      ),
      brokenCode: (
        <CodePre>
          <HoverCode sample={example.broken} />
        </CodePre>
      ),
    };
  });

  return <HomeStoryStage stories={stories} />;
}
