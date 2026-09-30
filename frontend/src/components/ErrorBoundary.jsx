import { Component } from 'react';

// Catches any render/lifecycle error in the subtree and shows a friendly
// fallback with a "Try again" button. Without this, a single crash blanks
// the whole app to white.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { err: null };
  }
  static getDerivedStateFromError(err) {
    return { err };
  }
  componentDidCatch(err, info) {
    console.error('[ErrorBoundary]', err, info?.componentStack);
  }
  reset = () => this.setState({ err: null });
  reload = () => window.location.reload();
  goHome = () => { window.location.href = '/'; };

  render() {
    if (!this.state.err) return this.props.children;
    const msg = this.state.err?.message ?? String(this.state.err);
    return (
      <div
        style={{
          minHeight: '100vh',
          background: '#f8f5ef',
          display: 'grid',
          placeItems: 'center',
          padding: 24,
          fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
          color: '#15130f',
        }}
      >
        <div
          style={{
            maxWidth: 560,
            background: '#fbf7ee',
            border: '1px solid #eab8b4',
            borderRadius: 12,
            padding: '28px 30px',
            boxShadow: '0 20px 40px -22px rgba(60,45,20,.5)',
          }}
        >
          <p
            style={{
              fontFamily: "'Newsreader', Georgia, serif",
              fontSize: 12,
              letterSpacing: '.22em',
              textTransform: 'uppercase',
              color: '#d0161c',
              margin: 0,
            }}
          >
            Case File · Runtime Error
          </p>
          <h1
            style={{
              fontFamily: "'Newsreader', Georgia, serif",
              fontWeight: 500,
              fontSize: 36,
              letterSpacing: '-.02em',
              margin: '8px 0 12px',
            }}
          >
            Something misfired.
          </h1>
          <p style={{ fontSize: 13, lineHeight: 1.55, color: '#4a443b', margin: '0 0 14px' }}>
            The page tripped over an error mid-render. Nothing else is broken — you can retry, reload, or head back
            to the landing page.
          </p>
          <pre
            style={{
              background: '#fce4e0',
              border: '1px solid #f3c3bc',
              borderRadius: 6,
              padding: '10px 12px',
              fontSize: 11,
              lineHeight: 1.5,
              color: '#7d2419',
              overflow: 'auto',
              margin: '0 0 18px',
              maxHeight: 200,
              whiteSpace: 'pre-wrap',
            }}
          >
            {msg}
          </pre>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button
              onClick={this.reset}
              style={{
                border: '1px solid #15130f',
                background: '#15130f',
                color: '#fff',
                padding: '9px 18px',
                borderRadius: 6,
                fontFamily: "'Newsreader', serif",
                fontSize: 15,
                cursor: 'pointer',
              }}
            >
              Try again
            </button>
            <button
              onClick={this.reload}
              style={{
                border: '1px solid #b9b2a0',
                background: 'transparent',
                color: '#15130f',
                padding: '9px 18px',
                borderRadius: 6,
                fontFamily: "'Newsreader', serif",
                fontSize: 15,
                cursor: 'pointer',
              }}
            >
              Reload page
            </button>
            <button
              onClick={this.goHome}
              style={{
                border: '1px solid #b9b2a0',
                background: 'transparent',
                color: '#15130f',
                padding: '9px 18px',
                borderRadius: 6,
                fontFamily: "'Newsreader', serif",
                fontSize: 15,
                cursor: 'pointer',
              }}
            >
              Back to landing
            </button>
          </div>
        </div>
      </div>
    );
  }
}
