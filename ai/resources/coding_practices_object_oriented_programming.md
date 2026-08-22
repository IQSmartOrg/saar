# Object-Oriented Programming

Object-oriented programming is powerful and valuable in the right circumstances, but it's a form of
complexity and as such should be viewed as a necessary evil to be minimized.

# Use the least amount of OOP possible

The simplest code is procedural code:

- Functions calling each other
- If statements
- Classes that are simply a collection of fields

When you must use OOP, use the simplest form that can solve your problem.

- Most often: An interface with multiple implementations.
- Sometimes: Single-level inheritance.
- Rarely: Multi-level inheritance.
- Almost never: new generic classes.

Elaborate OOP can be seductive. We all love to show our cleverness, and OOP schemes can be very
clever. Resist this urge!

# Never "plan ahead"

Only solve the problems you have right now. Don't design OOP facilities for future extension. For
example, you should never define an interface that presently has only one implementation.

Instead, solve your problem in the simplest way that could possibly work, and refactor later.

# Avoid Over-Modularization

You will sometimes hear principles like:

- A function should not have more than n lines
- A class should not have more than n functions
- A module should not have more than n classes

These are bad heuristics because splitting up a function, class, or module into smaller pieces is
only helpful if these pieces correspond to actually separate concepts. If you take a body of code
that is all closely connected and split it into smaller pieces, you have made the code harder not
easier to understand, because the two pieces are still conceptually intertwined and one can only be
understood alongside each other. It is better to just let naturally big functions, classes, and
modules be big rather than force an unnatural split.
