
import React from 'react';

export default function HomePage() {
  return (
    <div className="container mx-auto p-8">
      <h1 className="text-3xl font-bold mb-6">Welcome to Inventory Management System</h1>
      <p className="mb-4">Please login to access the system features.</p>
      <a href="/login" className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded">
        Login
      </a>
    </div>
  );
}
