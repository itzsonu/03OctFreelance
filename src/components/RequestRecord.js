import React from "react";
export default function RequestRecord({ request }) {
  return <article className="request-record"><div className="request-title"><h3>{request.subject}</h3><span className="pill">{request.status}</span></div><small>Reference: {request._id} · {new Date(request.createdAt).toLocaleString()}</small><p className="preserve-lines">{request.message}</p>{request.history?.map((item, index) => <div className="request-response" key={index}><strong>{item.status} · {new Date(item.createdAt).toLocaleString()}</strong><p className="preserve-lines">{item.response}</p></div>)}</article>;
}
