# Breakout Rooms

Hosts and session-scoped co-hosts access Rooms beside People and Chat, or through
Manage rooms in the More menu. Create up to 20 child rooms per live parent meeting.
Rooms have independent presentation IDs, LiveKit rooms, chat/socket channels,
slides and whiteboard documents. They do not appear as dashboard presentations.

## Participant Movement

- Desktop drag-and-drop, individual move dropdowns, and checkbox group selection
  all require confirmation. Group moves accept up to 100 participants per action.
- Auto-assign distributes admitted audiences across active breakout rooms.
- The backend verifies meeting credentials, participant grants and destination
  ownership before updating persistent assignments. Offline participants are
  assigned too; authenticated room polling resolves their destination on reconnect.
- An active old LiveKit participant is removed before the destination is issued.
  The browser stops sharing, leaves the old room, and opens the destination meeting
  interface without a dashboard detour. This version uses page navigation rather
  than preserving the same browser media connection.
- Previous microphone/camera preferences are restored when browser permission
  permits. Tab speaker preferences retain the existing application's behaviour.
- Temporary audience/co-host credentials are scoped to the child session, and
  child access depends on the parent instance and its participant permissions.
- Co-host role changes within a child propagate to the parent grant. Removing a
  child participant revokes their parent grant; a host can explicitly readmit them.

## Closing and Recording

Close all rooms persists a 30-second deadline and returns assigned participants to
the main room. A timer processes closure; authenticated polling reconciles the
deadline after a process restart. Return to main can also be disabled per room.
Hosts can rename rooms and delete rooms without assigned participants or hosts.
Ending the parent through its meeting socket closes its child sessions as well.

Announcements are text notifications, not cross-room audio. Owner visits finalize
an active local recording before navigating. Each room visit is a separate local
recording scope; there is no combined recording of breakout conversations.

## Verification and Deployment

Schema migration: `20261006_0011`. The application's existing create-all startup
also creates the new tables. No production deployment is performed by these edits.

Backend regression tests include foreign-key cleanup, unauthorized operations,
co-host rights, stale credentials, group validation, transport failure, assignments,
room limits/policy and persisted closure. Chrome acceptance checks use a temporary
database and real HTTP/Socket.IO with mocked LiveKit transport. They check desktop
drag/drop and dropdown moves, mobile UI, retained microphone preference, owner
visits, return-to-main and the closure countdown.

Real multi-user LiveKit media transfer, existing screen-share flickering, Safari,
and production recording downloads require a staging-room verification before a
client demonstration. This implementation uses per-parent process-local operation
locks and the existing process-local participant registry. Multi-worker deployment
needs shared presence/coordination and distributed locks first. Self-hosted LiveKit
token revocation behaviour must be validated; removing a participant is not a claim
that every previously issued token is cryptographically invalidated.
