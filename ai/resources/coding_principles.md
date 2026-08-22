# Coding Principles

## Do not introduce new functionality that is not needed right now.

Always solve the concrete, immediate problems. Do not write new code if it will not be used right
away, or if there are no specific plans to use it in the near future. Unused code clutters the
codebase and unnecessarily increases its complexity. Do not imagine additional requirements. Do not
invent security or functional requirements that have not been explicitly required by our coding and
security standards.

## Make your code readable.

Prefer code that is harder to write but easier to read over code that is easier to write but harder
to read. Code is written once, but read many times, so readability is crucial.

## Do the right amount of testing.

Every part of our code should have an appropriate testing strategy. "No tests" is the wrong
approach, but "always 100% coverage" is also wrong. Tests should be meaningful: avoid tests that are
superficial or tautological. Test at the right level of abstraction: for some code, it is
appropriate to test the entire module together. It should be possible to refactor your code without
breaking your tests. On the other hand, you should rarely spin up the entire platform and do a "true
e2e" test.

## Follow our coding and code review standards.

These coding principles here are a set of guiding principles that get operationalized by our coding
and review standards. The standards are designed to promote these principles and reduce risk. Learn
them. Use them. Enforce them. They’re good for all of us.

## Address the main requirement, first and foremost. Iteratively.

Avoid getting lost in the surrounding requirements at the beginning. Non-functional requirements
such as operationalization, deployment, and observability (to name a few examples) are very
important but are second to addressing the main requirement. Proceed iteratively and get feedback on
addressing the main requirement first.

## Address non-functional requirements. Get your code production ready, and don’t make it an afterthought.

Your feature needs to be performant, reliable, observable, secure, alert-ready, and supportable (by
support and others), to mention a few. Don’t forget them but address them after you solve the main
requirement (problem) first.
