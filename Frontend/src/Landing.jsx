/**
 * Public landing page — resume / portfolio entry point.
 * CTA opens a fresh interview room (?room=…) which loads the live app.
 */

import "./Landing.css";

function startDemo() {
  const room = Math.random().toString(36).slice(2, 8);
  const base = import.meta.env.BASE_URL || "/";
  const url = new URL(base, window.location.origin);
  url.searchParams.set("room", room);
  window.location.assign(url.toString());
}

export default function Landing() {
  return (
    <div className="lp">
      <div className="lp-atmosphere" aria-hidden="true" />

      <header className="lp-top">
        <span className="lp-mark">CIP</span>
        <a
          className="lp-source"
          href="https://github.com/wajm1/Code-Interview-Platform"
          target="_blank"
          rel="noreferrer"
        >
          Source
        </a>
      </header>

      <main className="lp-hero">
        <div className="lp-copy">
          <p className="lp-brand">Code Interview Platform</p>
          <h1 className="lp-headline">Interview like you ship.</h1>
          <p className="lp-lede">
            A real-time shared editor with live chat and presence — built for
            collaborative technical interviews.
          </p>
          <div className="lp-actions">
            <button type="button" className="lp-cta" onClick={startDemo}>
              Try the live demo
            </button>
            <a
              className="lp-secondary"
              href="https://github.com/wajm1/Code-Interview-Platform"
              target="_blank"
              rel="noreferrer"
            >
              GitHub repo
            </a>
          </div>
        </div>

        <div className="lp-stage" aria-hidden="true">
          <div className="lp-product">
            <div className="lp-product-bar">
              <span />
              <span />
              <span />
              <em>room · live</em>
            </div>
            <div className="lp-product-body">
              <pre className="lp-code">
                <code>
                  <span className="lp-line lp-d1">
                    <i>1</i>
                    <b>def</b> two_sum(nums, target):
                  </span>
                  <span className="lp-line lp-d2">
                    <i>2</i>
                    {"    "}seen = {"{}"}
                  </span>
                  <span className="lp-line lp-d3">
                    <i>3</i>
                    {"    "}
                    <b>for</b> i, n <b>in</b> enumerate(nums):
                  </span>
                  <span className="lp-line lp-d4">
                    <i>4</i>
                    {"        "}
                    <b>if</b> target - n <b>in</b> seen:
                  </span>
                  <span className="lp-line lp-d5">
                    <i>5</i>
                    {"            "}
                    <b>return</b> [seen[target - n], i]
                  </span>
                  <span className="lp-line lp-d6">
                    <i>6</i>
                    {"        "}seen[n] = i
                    <span className="lp-caret" />
                  </span>
                </code>
              </pre>
              <aside className="lp-side">
                <p>In room</p>
                <ul>
                  <li>You</li>
                  <li>Interviewer</li>
                </ul>
                <p className="lp-chat-label">Chat</p>
                <div className="lp-chat">
                  <span>
                    <strong>Interviewer</strong> Walk me through the hashmap
                    approach.
                  </span>
                </div>
              </aside>
            </div>
          </div>
        </div>
      </main>

      <section className="lp-how">
        <h2>How a session works</h2>
        <p>
          Open a room, share the invite link, and code together. Presence and
          chat stay in sync while you run Python or JavaScript right in the
          browser.
        </p>
      </section>

      <footer className="lp-foot">
        <span>Built for mock interviews and peer practice.</span>
      </footer>
    </div>
  );
}
