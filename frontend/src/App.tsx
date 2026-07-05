import React from 'react';
import { Notifications } from '@mantine/notifications';
import { ModalsProvider } from '@mantine/modals';
import { LanguageProvider } from '@/contexts/LanguageContext';
import { AuthProvider, useAuth } from '@/hooks/useAuth';
import { useAppConfig } from '@/hooks/useAppConfig';
import { useLanguageSync } from '@/hooks/useLanguageSync';
import { NotificationProvider } from '@/providers/NotificationProvider';
import { ColorSchemeSync } from '@/providers/ColorSchemeSync';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Route, Routes, useLocation } from 'react-router-dom';
import { configureApiClient } from './config/apiClient';
import Auth from './pages/Auth';
import Bookings from './pages/Bookings';
import Requests from './pages/Requests';
import Collections from './pages/Collections';
import CollectionDetail from './pages/CollectionDetail';
import CreateItem from './pages/CreateItem';
import EditBook from './pages/EditBook';
import EditItem from './pages/EditItem';
import Home from './pages/Home';
import Index from './pages/Index';
import ItemDetail from './pages/ItemDetail';
import ItemBookingHistory from './pages/ItemBookingHistory';
import MyItems from './pages/MyItems';
import NotFound from './pages/NotFound';
import Profile from './pages/Profile';
import { Header } from './components/layout/Header';
import { MobileBottomNav } from './components/layout/MobileBottomNav';
import { hasBrowseParams } from './lib/browseParams';
import { useIsMobile } from './hooks/use-mobile';
import { localStorageColorSchemeManager, MantineProvider } from '@mantine/core';
import { mantineTheme } from './theme/mantine';

const queryClient = new QueryClient();

const colorSchemeManager = localStorageColorSchemeManager({ key: 'bubble-theme' });

// Configure the API client once at startup
configureApiClient();

// Root route dispatcher: on mobile, authenticated users land on the start page
// (bookings widget + newest items). Adding any browse/search param (e.g. via the
// bottom "Search" tab or the header search bar) switches to the browse listing.
// Desktop and anonymous visitors always get the browse page.
const RootRoute = () => {
  const isMobile = useIsMobile();
  const { session } = useAuth();
  const location = useLocation();

  if (isMobile && session && !hasBrowseParams(location.search)) {
    return <Home />;
  }
  return <Index />;
};

// Wraps routes that always require authentication, even when REQUIRE_LOGIN=false.
const AuthRequired = ({ children }: { children: React.ReactNode }) => {
  const { session } = useAuth();
  if (!session) {
    return <Auth />;
  }
  return <>{children}</>;
};

const ProtectedRoutes = () => {
  const { session, loading: authLoading } = useAuth();
  const { requireLogin, loading: configLoading } = useAppConfig();
  useLanguageSync();

  // Wait for both the session check and the config fetch to resolve
  if (authLoading || configLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-lg">Loading...</div>
      </div>
    );
  }

  // REQUIRE_LOGIN=true (default): gate everything behind login
  if (requireLogin && !session) {
    return <Auth />;
  }

  // REQUIRE_LOGIN=false or user is authenticated: render the app.
  // User-specific routes are individually guarded by <AuthRequired>.
  return (
    <div className={`min-h-screen bg-background ${session ? 'pb-16 md:pb-0' : ''}`}>
      <Header />
      <Routes>
        <Route path="/" element={<RootRoute />} />
        <Route path="/item/:itemUuid" element={<ItemDetail />} />
        <Route path="/item/:itemUuid/bookings" element={<ItemBookingHistory />} />
        <Route
          path="/create-item"
          element={
            <AuthRequired>
              <CreateItem />
            </AuthRequired>
          }
        />
        <Route
          path="/edit-item/:itemUuid"
          element={
            <AuthRequired>
              <EditItem />
            </AuthRequired>
          }
        />
        <Route
          path="/edit-book/:itemUuid"
          element={
            <AuthRequired>
              <EditBook />
            </AuthRequired>
          }
        />
        <Route
          path="/my-items"
          element={
            <AuthRequired>
              <MyItems />
            </AuthRequired>
          }
        />
        <Route
          path="/profile"
          element={
            <AuthRequired>
              <Profile />
            </AuthRequired>
          }
        />
        <Route
          path="/bookings"
          element={
            <AuthRequired>
              <Bookings />
            </AuthRequired>
          }
        />
        <Route
          path="/requests/:bookingId?"
          element={
            <AuthRequired>
              <Requests />
            </AuthRequired>
          }
        />
        <Route
          path="/collections"
          element={
            <AuthRequired>
              <Collections />
            </AuthRequired>
          }
        />
        <Route
          path="/collections/:collectionId"
          element={
            <AuthRequired>
              <CollectionDetail />
            </AuthRequired>
          }
        />
        {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
        <Route path="*" element={<NotFound />} />
      </Routes>
      <MobileBottomNav />
    </div>
  );
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <MantineProvider
      theme={mantineTheme}
      defaultColorScheme="auto"
      colorSchemeManager={colorSchemeManager}
    >
      <ColorSchemeSync />
      <ModalsProvider>
        <LanguageProvider>
          <AuthProvider>
            <NotificationProvider>
              <Notifications />
              <BrowserRouter>
                <ProtectedRoutes />
              </BrowserRouter>
            </NotificationProvider>
          </AuthProvider>
        </LanguageProvider>
      </ModalsProvider>
    </MantineProvider>
  </QueryClientProvider>
);

export default App;
