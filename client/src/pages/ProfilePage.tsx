
import React from 'react';

export default function ProfilePage() {
  return (
    <div className="container mx-auto p-6">
      <h1 className="text-3xl font-bold mb-6">My Profile</h1>
      
      <div className="bg-white p-6 rounded-lg shadow mb-6">
        <div className="flex flex-col md:flex-row">
          <div className="md:w-1/4 mb-4 md:mb-0">
            <div className="w-32 h-32 bg-gray-300 rounded-full mx-auto md:mx-0 flex items-center justify-center text-gray-600">
              <span className="text-5xl">👤</span>
            </div>
            <button className="mt-4 w-full px-4 py-2 bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300">
              Change Avatar
            </button>
          </div>
          
          <div className="md:w-3/4 md:pl-8">
            <form>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium mb-2">First Name</label>
                  <input 
                    type="text" 
                    className="w-full px-3 py-2 border border-gray-300 rounded-md" 
                    defaultValue="Nguyen"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2">Last Name</label>
                  <input 
                    type="text" 
                    className="w-full px-3 py-2 border border-gray-300 rounded-md" 
                    defaultValue="Admin"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2">Email</label>
                  <input 
                    type="email" 
                    className="w-full px-3 py-2 border border-gray-300 rounded-md" 
                    defaultValue="admin@example.com"
                    readOnly
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2">Phone</label>
                  <input 
                    type="tel" 
                    className="w-full px-3 py-2 border border-gray-300 rounded-md" 
                    defaultValue="+84 123 456 789"
                  />
                </div>
              </div>
              
              <button type="submit" className="mt-6 px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600">
                Save Changes
              </button>
            </form>
          </div>
        </div>
      </div>
      
      <div className="bg-white p-6 rounded-lg shadow">
        <h2 className="text-xl font-semibold mb-4">Change Password</h2>
        <form>
          <div className="mb-4">
            <label className="block text-sm font-medium mb-2">Current Password</label>
            <input 
              type="password" 
              className="w-full px-3 py-2 border border-gray-300 rounded-md" 
            />
          </div>
          <div className="mb-4">
            <label className="block text-sm font-medium mb-2">New Password</label>
            <input 
              type="password" 
              className="w-full px-3 py-2 border border-gray-300 rounded-md" 
            />
          </div>
          <div className="mb-4">
            <label className="block text-sm font-medium mb-2">Confirm New Password</label>
            <input 
              type="password" 
              className="w-full px-3 py-2 border border-gray-300 rounded-md" 
            />
          </div>
          <button type="submit" className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600">
            Update Password
          </button>
        </form>
      </div>
    </div>
  );
}
