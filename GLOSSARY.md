# Coding Tutor

A companion to an AI coding agent that explains the implementation aloud while it is being built, so the engineer follows and steers the work instead of reading about it afterwards.

## Language

**Narrated session**:
One implementation task carried out in explanation mode, from the problem restatement to the last part of the route. The engineer opts in per task.
_Avoid_: Tutorial, walkthrough, code walk (these suggest explaining finished code)

**Problem restatement**:
The opening of a narrated session: what is wrong or missing, in the context of this project, stated without the solution.
_Avoid_: Summary, plan

**Route**:
The ordered list of parts the agent will work through, each with a tempo, agreed with the engineer before any code is written.
_Avoid_: Plan, ticket breakdown, steps

**Part**:
One stop on the route: a piece of the work the engineer would recognise by name, such as "values.yaml" or "the smoke test".
_Avoid_: Step, task, chunk

**Tempo**:
How a part will be covered: its depth, plus any pattern such as show-one-batch-the-rest. The agent proposes it; the engineer can change it at the route or at any moment after.
_Avoid_: Speed, pace

**Show-one-batch-the-rest**:
A tempo for repetitive parts: the agent narrates one instance properly, produces the others without narration, then says briefly what each one does.

**Depth**:
How much the narration says about a part, on a scale of four named levels: skim, outline, walk, line-by-line. The engineer chooses which level is the default.
_Avoid_: Granularity, verbosity, detail level

**Skim**:
The depth that says in a sentence or two what was done and where.

**Outline**:
The depth that names each function or file and says what it is for and why it exists.

**Walk**:
The depth that goes inside each function and names its main components, such as a loop, a check, or a return value, without reading lines.

**Line-by-line**:
The depth that covers every line, including alternatives that were rejected.
_Avoid_: Deep

**Narration**:
What the agent says about the work, spoken aloud and shown as captions at the same time.
_Avoid_: Explanation, commentary

**Pointer**:
The visual mark on the code the narration is currently about.
_Avoid_: Highlight, decoration, cursor

**Interrupt**:
The engineer stopping the narration mid-flow to say something to the agent: to ask, to change the tempo, or to object. What they say reaches the agent before anything else it does.
_Avoid_: Checkpoint, gate, message

**Pause**:
The engineer holding the session to think, without saying anything. The agent waits, and the narration picks up where it stopped.
_Avoid_: Hold, break, stop

**Session script**:
The editable plain-text instructions that define how a narrated session runs: its opening, the route, how each depth sounds, and how interrupts are handled.
_Avoid_: Prompt, config, system prompt

**Recap**:
The spoken close of a narrated session: what was built, part by part, and what the engineer should check themselves.

**Transcript**:
The saved captions of a narrated session.

**Engineer**:
The person following the narrated session.
_Avoid_: User, student, learner, junior
