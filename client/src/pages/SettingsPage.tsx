
import React from 'react';

export default function SettingsPage() {
  return (
    <div className="container mx-auto p-6">
      <h1 className="text-3xl font-bold mb-6">Settings</h1>
      
      <div className="bg-white p-6 rounded-lg shadow mb-6">
        <h2 className="text-xl font-semibold mb-4">General Settings</h2>
        <form>
          <div className="mb-4">
            <label className="block text-sm font-medium mb-2">Company Name</label>
            <input 
              type="text" 
              className="w-full px-3 py-2 border border-gray-300 rounded-md" 
              defaultValue="Inventory Management System"
            />
          </div>
          <div className="mb-4">
            <label className="block text-sm font-medium mb-2">Currency</label>
            <select className="w-full px-3 py-2 border border-gray-300 rounded-md">
              <option>VND</option>
              <option>USD</option>
              <option>EUR</option>
            </select>
          </div>
          <div className="mb-4">
            <label className="block text-sm font-medium mb-2">Time Zone</label>
            <select className="w-full px-3 py-2 border border-gray-300 rounded-md">
              <option>Asia/Ho_Chi_Minh (GMT+7)</option>
              <option>UTC</option>
              <option>America/New_York</option>
            </select>
          </div>
          <button type="submit" className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600">
            Save Changes
          </button>
        </form>
      </div>
      
      <div className="bg-white p-6 rounded-lg shadow">
        <h2 className="text-xl font-semibold mb-4">Email Notifications</h2>
        <div className="space-y-4">
          <div className="flex items-center">
            <input type="checkbox" id="lowStock" className="mr-2" defaultChecked />
            <label htmlFor="lowStock">Low stock alerts</label>
          </div>
          <div className="flex items-center">
            <input type="checkbox" id="newOrders" className="mr-2" defaultChecked />
            <label htmlFor="newOrders">New order notifications</label>
          </div>
          <div className="flex items-center">
            <input type="checkbox" id="systemUpdates" className="mr-2" />
            <label htmlFor="systemUpdates">System updates</label>
          </div>
          <button className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600">
            Save Preferences
          </button>
        </div>
      </div>
    </div>
  );
}
