import React from 'react';
import { useUIStore } from '@/stores/ui-store';
import AppBar from './AppBar';
import Sidebar from './Sidebar';

export interface LayoutProps {
  children: React.ReactNode;
}

/**
 * Layout component
 *
 * Provides the main app shell with:
 * - AppBar spanning full width at top
 * - Two-column layout below: Sidebar (left) + Main content (right)
 * - Responsive design: sidebar toggles on mobile via UI store
 * - Uses Tailwind CSS for styling and responsiveness
 */
export const Layout: React.FC<LayoutProps> = ({ children }) => {
  const { sidebarOpen } = useUIStore();

  return (
    <div className="flex flex-col h-screen w-full bg-gray-50">
      {/* AppBar */}
      <AppBar />

      {/* Main content area: sidebar + content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar - hidden on mobile unless toggled */}
        {sidebarOpen && (
          <div className="hidden md:flex md:w-96 md:flex-col md:border-r md:border-gray-200 md:bg-white overflow-y-auto">
            <Sidebar />
          </div>
        )}

        {/* Mobile sidebar overlay - shown on mobile when sidebarOpen is true */}
        {sidebarOpen && (
          <div className="fixed inset-0 z-40 bg-black bg-opacity-50 md:hidden" />
        )}
        <div
          className={`fixed top-16 left-0 bottom-0 w-96 bg-white border-r border-gray-200 z-50 overflow-y-auto transform transition-transform md:hidden ${
            sidebarOpen ? 'translate-x-0' : '-translate-x-full'
          }`}
        >
          <Sidebar />
        </div>

        {/* Main content area */}
        <div className="flex-1 overflow-auto">
          {children}
        </div>
      </div>
    </div>
  );
};

export default Layout;
