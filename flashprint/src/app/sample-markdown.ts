/// Markdown loaded into the editor on first visit, when no saved
/// document exists yet. Long enough to span a few pages so the fitter
/// has real work to do.
export const SAMPLE_MARKDOWN = `# Notes on Spaced Repetition

Spaced repetition is a learning technique that schedules review sessions
at increasing intervals. Instead of cramming, a learner sees each fact
right before it would otherwise be forgotten. This document summarizes
the idea, the evidence behind it, and how to put it into practice.

## Why forgetting is predictable

Hermann Ebbinghaus measured his own recall of nonsense syllables in the
1880s and found that memory decays on a curve, fast at first and then
slower. The practical consequence: a short delay before the first review
does more to cement a memory than reviewing immediately.

* Recall drops fastest in the first day after learning.
* Each successful review flattens the curve further out.
* A failed review resets the interval, not the whole schedule.
* Interleaving topics improves retention over blocked practice.

## A simple algorithm

Most spaced repetition software schedules cards with a variant of the
SM-2 algorithm. The steps below describe one review cycle.

1. Show the card and record whether the answer was correct.
2. Update an ease factor based on how hard the recall felt.
3. Multiply the previous interval by the ease factor.
4. Schedule the next review that many days out.
5. If the answer was wrong, reset the interval to one day.

### Ease factor bounds

| Grade | Meaning | Ease change |
| --- | --- | --- |
| 0 | Complete blackout | -0.8 |
| 1 | Wrong, but familiar | -0.54 |
| 2 | Wrong, easy to recall | -0.32 |
| 3 | Correct, with effort | -0.14 |
| 4 | Correct, after hesitation | 0.0 |
| 5 | Correct, instant | +0.1 |

The ease factor is clamped so it never drops below 1.3. A deck that
stays above 2.5 on average is a deck of facts the learner already knows
well; new material pulls the average down again.

> The point of spaced repetition is not to make review easy. It is to
> make review happen exactly when it is about to become hard, which is
> the moment recall does the most for retention.

## Building a deck

A good card asks one question. A card that bundles three facts forces a
partial-credit grade, which the algorithm cannot schedule well.

- [x] Write the question as a specific, answerable prompt.
- [x] Keep the answer short enough to grade at a glance.
- [ ] Add an image only when the image is the thing being tested.
- [ ] Delete or rewrite any card graded wrong three times in a row.

Cloze deletions work well for vocabulary: \`The mitochondrion is the
{{c1::powerhouse}} of the cell.\` They work poorly for anything that
needs multi-step reasoning, since the algorithm cannot tell which step
tripped the learner up.

## The math behind the interval curve

Retention after \`t\` days with stability \`S\` follows roughly
$R(t) = e^{-t/S}$, so review works best when it lands close to the day
retention crosses a target threshold, commonly 90%. Solving for that
day gives:

$$
t^* = -S \\ln(0.9)
$$

Software that adapts \`S\` per card, rather than using one global
interval, converges on this target faster because it learns each card's
difficulty separately.

## Practical tips

Review in short daily sessions rather than long infrequent ones. A
five-minute session every day outperforms a single weekly hour, because
the timing of each card matters more than the total time spent.

\`\`\`ts
interface Card {
  interval: number
  ease: number
  due: Date
}

function schedule(card: Card, grade: number): Card {
  const ease = Math.max(1.3, card.ease + (0.1 - (5 - grade) * 0.08))
  const interval = grade < 3 ? 1 : Math.round(card.interval * ease)
  const due = new Date(Date.now() + interval * 86_400_000)
  return { interval, ease, due }
}
\`\`\`

Keep decks small and specific. A deck mixing unrelated subjects makes
it harder to notice when one topic's cards are consistently failing,
which is the signal that the cards themselves need rewriting.
`
