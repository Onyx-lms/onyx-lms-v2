# ADR-004: which generation of the messaging code to port

## Status

Accepted (S12).

## Context

`message_threads` and `messages` are real tables with real columns:

```
message_threads   id, code, contact_one, contact_two, created_at, updated_at
messages          id, thread_id, sender_id, receiver_id, message, read, ...
```

Three different implementations in the Laravel source write to "messaging", and
they disagree about what those columns are called.

**Generation 1 -- `app/Http/Controllers/ChatController.php`.** Uses models
`Chat` and `Message_thrade` against tables `chats` and `message_thrades`.
Neither table exists. `App\Models\Message_thrade` is not in the repository at
all, so the file raises a fatal error the moment Laravel resolves it. Every
route in `routes/chat.php` points here, and four of them (`react_chat`,
`search_chat`, `chat_load`, `chat_read_option`) name methods the class does not
even define.

**Generation 2 -- `frontend/Chatcontroller`, `count_unread_message_of_thread()`
in `Common_helper.php`, and `Admin\MessageController::searchThreads()`.** These
use `message_thread_code`, `sender`, `receiver` and `read_status`. None of those
columns exist on the current tables, so every one of these paths throws.

**Generation 3 -- `student/MessageController` and the rest of
`Admin\MessageController`.** These use `thread_id`, `sender_id`, `receiver_id`,
`read`, `code`, `contact_one`, `contact_two` -- the columns that are actually
there.

## Decision

Port generation 3. It is the only one that can execute against the shipped
schema, and it is the one the student and admin message views are wired to.

`count_unread_message_of_thread()` is reimplemented against the real columns,
keeping its rule exactly: count the messages in a thread that the current user
did not send and has not read. It runs once for the whole inbox rather than once
per thread.

## Consequences

- **Reactions (`react_chat`, task M-04) are not implemented.** There is no
  reaction column, no reaction table, and no method behind the route -- the
  string `react_chat` appears once in the entire codebase, in `routes/chat.php`,
  pointing at a method that does not exist. There is nothing to port, and
  inventing storage for it would be a schema change.
- **File attachments on messages are not implemented.** Generation 3 writes
  `media_files` rows with `chat_id`, but `media_files` has no `chat_id` column,
  so the insert throws. Text messages work; attachments were never functional.

## Two access-control bugs deliberately not carried over

- `student/MessageController::store()` takes `thread_id` from the request and
  never checks that the sender belongs to that thread, so any signed-in account
  could post into any conversation by guessing an id. Participation is enforced
  here.
- `Admin\MessageController::store()` takes `sender_id` from the request, letting
  an admin post a message that appears to come from any user. Here the sender is
  always the authenticated account.

## One more thing that is fixed rather than copied

`student/MessageController::index()` builds the thread sidebar with
`where('contact_one', $me)->where('contact_two', $me)` -- an AND, which only
matches a thread someone opened with themselves. The sidebar is empty for every
real conversation. It should be, and here is, an OR.
