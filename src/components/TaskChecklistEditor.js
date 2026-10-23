import React from "react";

export default function TaskChecklistEditor({ items, onChange }) {
  function update(index, fields) { onChange(items.map((item, position) => position === index ? { ...item, ...fields } : item)); }
  return <section className="task-checklist-editor" aria-label="Subtasks and checklist">
    <div className="task-checklist-heading"><h3>Subtasks / checklist</h3><span>{items.filter(item => item.done).length} / {items.length} checked</span></div>
    <p className="form-help">Break the work into small steps. Checking every step leaves the parent task status for you to choose.</p>
    {items.map((item, index) => <div className="task-checklist-edit-row" key={item._id || `new-${index}`}>
      <input type="checkbox" aria-label={`Complete subtask ${index + 1}`} checked={item.done} onChange={event => update(index, { done: event.target.checked })} />
      <label><span className="visually-hidden">Subtask {index + 1}</span><input required maxLength={160} value={item.title} placeholder="What is the next step?" onChange={event => update(index, { title: event.target.value })} /></label>
      <button type="button" className="icon-button" aria-label={`Remove subtask ${index + 1}`} onClick={() => onChange(items.filter((_, position) => position !== index))}>×</button>
    </div>)}
    <button type="button" className="button button-outline" disabled={items.length >= 30} onClick={() => onChange([...items, { title: "", done: false }])}>+ Add subtask</button>
    <small className="form-help">Up to 30 steps per task. Changes are stored when you save the task.</small>
  </section>;
}
