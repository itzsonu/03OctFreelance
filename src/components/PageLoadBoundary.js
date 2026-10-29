import React from "react";

export default class PageLoadBoundary extends React.Component {
  state = { error: null };
  static getDerivedStateFromError(error) { return { error }; }
  render() {
    if (!this.state.error) return this.props.children;
    const loading = /ChunkLoadError|Loading (?:CSS )?chunk|dynamically imported module/i.test(`${this.state.error.name} ${this.state.error.message}`);
    return <main className="empty-state" role="alert">
      <h1>{loading ? "This page could not finish loading" : "This page could not be displayed"}</h1>
      <p>{loading ? "A page file was interrupted or the app was updated. Reload to get the current version." : "Reload the page to try again. Your saved work remains in your account."}</p>
      <button type="button" className="button button-dark" onClick={() => window.location.reload()}>Reload page</button>
    </main>;
  }
}
