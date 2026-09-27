import { Component, type ErrorInfo, type ReactNode } from "react";

interface State { error: Error | null }

/**
 * Catches render errors so one broken panel never white-screens the game.
 * Shows what happened and offers retry / reload. Never auto-reports anywhere
 * (no third-party telemetry = no data leaks, checklist #50/#68).
 */
export class ErrorBoundary extends Component<{ children: ReactNode; label?: string; compact?: boolean }, State> {
  state: State = { error: null };
  static getDerivedStateFromError(error: Error): State { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error(`[RECURSIA] ${this.props.label ?? "ui"} crashed`, error, info.componentStack); }
  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const text = `${error.name}: ${error.message}`;
    return (
      <div className={this.props.compact ? "crash compact" : "crash"} role="alert">
        <div className="crash-title">{this.props.compact ? "Панель не отрисовалась" : "Что-то пошло не так"}</div>
        <code className="crash-msg">{text}</code>
        <p className="muted small">Ваши средства в безопасности: интерфейс ничего не подписывает без вашего подтверждения.</p>
        <div className="row-wrap">
          <button className="btn" onClick={() => this.setState({ error: null })}>Повторить</button>
          {!this.props.compact && <button className="btn" onClick={() => window.location.reload()}>Перезагрузить страницу</button>}
          <button className="btn" onClick={() => navigator.clipboard?.writeText(`${text}\n${error.stack ?? ""}`)}>Скопировать ошибку</button>
        </div>
      </div>
    );
  }
}
