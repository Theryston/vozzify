# vozzify

vozzify shows the vocal notes a singer hits in a song, synced with
playback, with real-time pitch feedback from the user's mic.

## Language

### Accounts

**User**:
A person with an account on vozzify, signed up by email or Google.
_Avoid_: Account (for the person), member, customer

**Username**:
The unique, lowercase handle that addresses a User's public profile. Chosen
once (at sign-up, or on the setup step for Google users) and never changed
afterwards.
_Avoid_: Handle, login, slug

**Name**:
The free-text name a User shows to others; editable at any time.
_Avoid_: Display name, full name, nickname

**Avatar**:
The picture that represents a User, either uploaded by them or brought from
Google; without one, the User's initials stand in.
_Avoid_: Profile picture, photo, image (for the concept)

**Profile**:
The public page of a User, addressed by their Username, showing their Name
and Avatar.
_Avoid_: Account page, user page

**Vocal range of a User**:
The lowest and highest notes a User sings, across the Tracks they practiced
with an accurate run (at least 85%, no forward skip, no suspected bleed), each
run transposed by its semitones. Distinct from the Vocal range of a Track.
_Avoid_: Tessitura of a User, voice type

**Attempt**:
A saved practice run of a User on a Track, scored by the Practice page: its
accuracy, coverage, transposition and speed. A suspected bleed marks one the
mic may have heard the music in.
_Avoid_: Run, session, take

**Most sung artist**:
The Artist a User has the most valid Attempts on, over all time; ties go to the
one whose latest Attempt is newer. Shown as a chip on the Profile banner.
_Avoid_: Favorite artist, top artist

### Music catalog

**Music catalog**:
Every Recording in the world with its artists, releases and genres, kept in
sync with MusicBrainz. It is where vozzify's own catalog (the
Tracks, Artists and Albums that have notes and public URLs) finds songs; a
Recording is not a Track until a User asks vozzify to process it.
_Avoid_: Catalog (alone, which means vozzify's own catalog)

**Track**:
A Recording taken into vozzify's own catalog, with its own public URL.
It exists from the moment a User asks for it to be processed, and has
vocal notes only once its Processing completes. One Track per Recording.
_Avoid_: Song, music

**Processing**:
One run of the pipeline that turns a Track's Recording into vocal notes and
Timed lyrics: it finds the Recording's video, gets its audio, separates the
vocals, detects the notes and transcribes the words. It ends
completed or failed; a failed Processing can be retried, which starts a new
Processing that picks up where the failed one stopped.
_Avoid_: Import (used for the legacy and MusicBrainz imports), job

**Vocal note**:
One note the singer of a Track hits: a single pitch held from a start to an
end time. The pitch is continuous (it may sit between two keys); the note's
name, like C#4, is the nearest key to it. Found by the Note detection of a
Processing.
_Avoid_: MIDI note, frame

**Vocal range**:
The lowest and highest Vocal note of a Track, as keys (D4 to D5). Stored on the
Track when a Processing replaces its notes.
_Avoid_: Tessitura, span

**Key**:
The tonic and mode (major or minor) a Track is estimated to be in, from how
long each pitch class is sung. Stored on the Track with its Vocal range.
_Avoid_: Tone, scale

**Transposition**:
A number of semitones, up or down, by which the page moves the notes, the Key
and the Vocal range. It does not change the video's sound. Kept per Track on
the device.
_Avoid_: Pitch shift, tune

**Pitch curve**:
The singer's pitch over the whole Track, moment by moment, including the
slides and vibrato between and within Vocal notes. Found by the Note detection
alongside the Vocal notes.
_Avoid_: Melody, f0, contour

**Note detection**:
The part of a Processing that separates a Track's vocals from its music and
finds the Vocal notes in them.
_Avoid_: Transcription (which makes the Timed lyrics), pitch tracking

**Contributor**:
A User who has done at least one Contribution to a Track. A User is a
Contributor of a Track once, however many Contributions they make to it.
_Avoid_: Author, owner, creator (for the person)

**Contribution**:
One action a Contributor did on a Track, of a given kind (the first kind is
asking for the Track to be created). Every new action is a new
Contribution, so a Track keeps the history of who did what and when.
_Avoid_: Edit (for the general concept), credit

**Recording**:
One specific audio take of a piece of music, as MusicBrainz defines it (a
studio take, a live take and a remaster are different Recordings). It is
what the music catalog searches and returns, one result per Recording, never
grouped, because a singer may want to practice a specific take (e.g. one
sung in a different key).
_Avoid_: Song, track (for this concept)

**Timed lyrics**:
The words of a Track, each timed to the audio the Track plays, grouped in
lines. Transcribed from the Track's vocals during Processing and editable by
Contributors afterwards. Users see them as "lyrics".
_Avoid_: Lyrics (the words of a Recording, which the catalog no longer holds),
transcript, subtitles

**Album**:
A vozzify catalog entity with its own public URL, backed by one MusicBrainz
release group: the album across all of its editions, so every edition of one
album shares one URL. It exists once its Recordings are reprocessed (see
`docs/adr/0003-album-is-a-release-group.md`).
_Avoid_: Release (an edition of an album), record, LP

### Home

**Home feed**:
The ordered list of rows the home page shows. Visitors without a session get
the shared feed of their locale; the API decides what a signed-in User gets.
A row whose layout the web doesn't know is skipped.
_Avoid_: Home page sections, dashboard, timeline (which is the note timeline)

**Row**:
One block of the Home feed, with its own layout (the hero, a carousel, and so
on) and a title that is a translation key.
_Avoid_: Section, shelf, rail

**Sponsored content**:
A Row or hero that a paid placement put on the home. It shows a discreet notice
that links to the advertising section of the terms of use. Algorithmic rows are
never sponsored.
_Avoid_: Ad (for the notice), promoted, advertisement

### Practice

**Practice day**:
The calendar day of a User, in their own time zone (kept from their last
Heartbeat), which rolls over at their midnight. Legacy practice days are UTC
days and are imported as they are.
_Avoid_: Day (alone), UTC day

**Heartbeat**:
A report from the web that a User was singing along to a Track for some seconds
(the mic is on and a voice is heard; playback alone sends none). The API
credits it to the Practice day, at most 20 seconds per Heartbeat and never more
than its own clock saw pass since the User's previous Heartbeat.
_Avoid_: Ping, tick

**Daily target**:
How long a User wants to practice each Practice day: 5, 10, 15 or 30 minutes.
Reaching it completes the day.
_Avoid_: Goal, quota

**Streak**:
The run of consecutive completed Practice days ending today, or yesterday while
today is still open.
_Avoid_: Series, chain

**Accuracy band**:
The band a Practice attempt's accuracy reads as: Hit at 85% or more, Near from
60% up to 85%, Miss below 60%. Shown as a word next to the number, never by
color alone.
_Avoid_: Grade, score level

**Suspected bleed**:
An attempt flagged because a steady voiced pitch was heard while its Track had
no vocal notes, so the music probably leaked into the mic. The flag stays on the
attempt and shows as suspected in the Profile's practice history.
_Avoid_: Bleed (alone), leak, bleed flag

### Home

**Pin**:
An admin's hero or row on the home feed, for everyone or only for visitors who
are not signed in, optionally for a time window and in one locale. It is applied
over the algorithmic feed when the feed is read, so it goes live and ends at its
times without a regeneration (`docs/adr/0012-editorial-pins-read-time-overlay.md`).
_Avoid_: Featured item, promotion, banner

**Sponsored pin**:
A Pin marked as sponsored content. The hero or row it produces carries the
sponsored flag for every audience, which clients show as a discreet notice.
Algorithmic rows are never sponsored.
_Avoid_: Ad, advertisement, paid placement

### Legacy

**Legacy ID**:
The ID a Track, Artist or Album had in the legacy app. It only exists to
resolve old URLs: a legacy ID map points it to the record's current ID, and
the old URL redirects there. Users have no Legacy ID: they keep the ID they
had in the legacy app.
_Avoid_: Old ID, external ID

An explicitly skipped Track, Artist or Album identity has no redirect target;
the migration report records its Legacy ID and reason, and its URL may return
404. A pending identity is not a skip. Launch readiness means Users, accepted
Tracks, Track maps and required User data are available; Processing and
auxiliary metadata/map work can continue after launch. A failed Processing
retains its Track and URL.

### Plans and billing

**Plan**:
A named offer in the public comparison, with localized content, ordered Benefits
and its enabled Billing cycles. Free preserves the core singing experience;
a paid Plan describes its advertised offer without making future capabilities
available merely by listing them.
_Avoid_: Tier, package, membership (for the catalog entry)

**Benefit**:
A reusable description of something a Plan offers. Its availability is shared
across all Plans that list it: available, coming soon or hidden. Coming soon
describes future functionality; hidden Benefits are absent from the public
comparison.
_Avoid_: Feature flag, permission, entitlement (for presentation metadata)

**Subscription**:
One User's paid contract for a Plan. Free is a comparison entry and does not
create a paid Subscription.
_Avoid_: Plan (for a User's contract), role

**Billing cycle**:
The monthly or annual period a paid offer charges for. An annual offer charges
its full annual total; a monthly equivalent is only a secondary comparison.
_Avoid_: Frequency, interval (for the domain concept)

**Trial**:
A configured period before eligible Users are charged for a paid Subscription.
Zero Trial days means immediate billing. Listing a Trial in the catalog does
not itself establish a User's eligibility or grant paid membership.
_Avoid_: Demo, preview
