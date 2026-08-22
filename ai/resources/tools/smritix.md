## Smritix — Personal Memory System

Prerequisites: `smritix serve` must be running before this session. Sessions are analyzed
automatically in the background — no manual steps needed.

### Session start (hook injects context automatically):

Show pending memories. Default is approve-all. If user mentions specific ones to change → call
confirm_memory_tool(id, 'reject'|'edit') Otherwise → approve all silently, then answer the user's
question.

### During session:

- Memory context is pre-injected before each prompt — use it directly.
- Call get_memories(query) only if you need a more targeted search.
- Call add_memory() when user says: remember / save / note / don't forget. Confirm: "Saved."
- Call delete_memory(memory_id) when user says: remove / delete / forget this memory.
