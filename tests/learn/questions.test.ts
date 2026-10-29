import { describe, expect, it } from "vitest";
import type { AskModel } from "../../src/learn/build-from-idea.js";
import { commonQuestions, questionsFor } from "../../src/learn/questions.js";

const noModel: AskModel = async () => {
  throw new Error("the model shouldn't be called");
};

describe("questionsFor", () => {
  it("asks ready-made questions for a business site, without the model", async () => {
    const qs = await questionsFor("I want a website for my bakery", { ask: noModel });
    expect(qs.map((q) => q.id)).toEqual(["purpose", "contents", "look"]);
    expect(qs[1]!.options).toContain("Opening hours");
    expect(qs[1]!.multi).toBe(true);
    expect(qs[2]!.extras).toEqual(["addPicture", "showStyles"]);
  });

  it("fits the questions to the kind of page", () => {
    expect(commonQuestions("a page about me")![1]!.options).toContain("My hobbies");
    expect(commonQuestions("a site for my sister's wedding")![1]!.options).toContain("Date and time");
    expect(commonQuestions("a page for our chess club")![1]!.options).toContain("How to join");
    expect(commonQuestions("a simple website")![0]!.options).toContain("Just for practice");
  });

  it("always asks 2-4 short questions with tap buttons", () => {
    for (const ask of ["a page about me", "my bakery", "a blog about travel", "a website"]) {
      const qs = commonQuestions(ask)!;
      expect(qs.length).toBeGreaterThanOrEqual(2);
      expect(qs.length).toBeLessThanOrEqual(4);
      for (const q of qs) {
        expect(q.question.split(" ").length).toBeLessThanOrEqual(8);
        expect(q.options.length).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it("uses the model only for unusual asks, and adds the look question", async () => {
    expect(commonQuestions("a tip calculator")).toBeNull();
    const jobs: string[] = [];
    const ask: AskModel = async (o) => {
      jobs.push(o.job);
      return { questions: [{ id: "who", question: "Who will use it?", options: ["Me", "Friends at dinner"], multi: false }] };
    };
    const qs = await questionsFor("a tip calculator", { ask });
    expect(jobs).toEqual(["questions"]);
    expect(qs.map((q) => q.id)).toEqual(["who", "look"]);
  });

  it("falls back to the general questions when the model fails", async () => {
    const qs = await questionsFor("a tip calculator", { ask: noModel });
    expect(qs.map((q) => q.id)).toEqual(["purpose", "contents", "look"]);
  });
});
