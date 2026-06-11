import { Anchor, Text, Title } from '@mantine/core';
import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    console.error('404 Error: User attempted to access non-existent route:', location.pathname);
  }, [location.pathname]);

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <Title order={1} className="mb-4">
          404
        </Title>
        <Text size="xl" c="dimmed" className="mb-4">
          Oops! Page not found
        </Text>
        <Anchor href="/" underline="always">
          Return to Home
        </Anchor>
      </div>
    </div>
  );
};

export default NotFound;
