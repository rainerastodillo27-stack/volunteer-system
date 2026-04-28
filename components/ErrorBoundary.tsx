import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';

type Props = { children: React.ReactNode };
type State = { hasError: boolean; error?: Error | null; info?: any };

export default class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, info: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: any) {
    // Log the error so it appears in the console/devtools
    // eslint-disable-next-line no-console
    console.error('Uncaught component error:', error, info);
    this.setState({ error, info });
  }

  render() {
    if (!this.state.hasError) return this.props.children as any;

    return (
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.card}>
          <Text style={styles.title}>Something went wrong</Text>
          <Text style={styles.message}>{this.state.error?.message || 'Unknown error'}</Text>
          <Text style={styles.stack}>{String(this.state.info?.componentStack || '')}</Text>
        </View>
      </ScrollView>
    );
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'stretch', padding: 20, backgroundColor: '#fff' },
  card: { backgroundColor: '#fff', padding: 18, borderRadius: 8, borderWidth: 1, borderColor: '#eee' },
  title: { fontSize: 18, fontWeight: '700', marginBottom: 6, color: '#b91c1c' },
  message: { fontSize: 14, marginBottom: 8, color: '#111' },
  stack: { fontSize: 12, color: '#444' },
});
