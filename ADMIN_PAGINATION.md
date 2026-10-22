# Administration and paginated lists

## Admin overview and moderation

Administrator sign-in now opens `/admin/overview`, with platform totals and paginated account/listing search. The existing `/admin/cases` evidence and resolution workflow stays available through the navigation and overview link.

- Account suspension requires a 10–1000 character reason and the latest moderation version. It revokes existing sessions, blocks login and hides the account's listings/talent profile from discovery. Restoration requires a fresh sign-in; old sessions cannot become valid again.
- Administrators cannot suspend themselves or other administrators through this interface. Client and freelancer sessions cannot use any admin endpoints.
- Listing moderation applies to unassigned Open/Closed projects. Hiding removes a listing from discovery and blocks new proposals, invitations and agreements. Restoring retains the prior hiring status. Each hide/restore increments the listing revision so earlier offers need fresh agreement.
- Assigned work must be handled through case review. Moderation does not remove proposals, approved work, files or original agreements, and does not process refunds or payments.
- The target document retains each decision's actor, name, reason and time in the same atomic update as its restriction. History is private to administrators and paginated per record. Conditional versions reject stale or duplicate decisions.

Suspended users are rejected during session restoration and live-stream checks. Public lists exclude suspended project owners at query time, including posts created concurrently with suspension. New hiring checks also inspect participant availability. This is moderation support, not an automatic spam classifier or a general suspension of every contract involving the account.

## List behavior

Client projects, freelancer assigned/saved projects, applications, applicant comparison, project inbox, admin cases, accounts and moderation history have bounded server pages. Project pickers for talent invitations also page through eligible projects. Public project/talent search already paginated; suspended or hidden records are now excluded there.

`page` starts at 1; `pageSize` is 1–50. Existing list URLs without pagination return a bounded first page as a legacy array. Explicit page requests return `{items,total,page,pageSize,pages}` and any relevant summary. Client/freelancer workspace counters cover the full account; pulse/outlook cards cover the displayed page. Date sorts include the unique ID as a stable tie-break. New activity may move records between offset pages; these lists do not promise a frozen snapshot.

Applicant filters and ordering are applied before slicing the response, preserving global pending/shortlist/fit ordering. AI comparison still has its existing applicant bound. Fit/trust computation currently reads the project's candidate set to produce that global ordering; response pagination does not turn ranking into a precomputed search index. Very large candidate sets still need additional ranking/index work and measured load tests before a scale claim.

## Conversation history

`GET /api/messages/application/:id?limit=30` returns the latest page with `beforeCursor`, `afterCursor` and `hasOlder`. `before` retrieves older history; `after` catches up after the last loaded message, with `hasMore` when more than one page arrived. Cursors include creation time and ID, so equal timestamps do not lose messages. Limit is bounded at 50; invalid or simultaneous before/after cursors are rejected.

The UI retains loaded older history during live updates, merges message IDs once, catches up across multiple pages and ignores late responses belonging to a different conversation. Loading older messages preserves scroll position. Only returned incoming messages are marked read. A failed load leaves the existing history and typed reply available.

## Verification and configuration

`npm --prefix backend run test:admin-pagination` uses a uniquely named temporary database and checks access boundaries, global counts, tied timestamps, applicant filters, 150 old messages, multi-page live catch-up, listing restrictions and suspension/restoration. The existing client-to-freelancer integration workflow is also compatible with the new lists. Frontend checks cover moderation confirmation, record paging and conversation history retention.

No live user was suspended, no existing database was reset, and no production admin account was created for these checks. Use the existing private `admin:create` setup when an operator needs an administrator account. Email delivery remains a separate deferred setup.
