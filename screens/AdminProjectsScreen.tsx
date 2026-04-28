import ProjectLifecycleScreen from './ProjectLifecycleScreen';
import ErrorBoundary from '../components/ErrorBoundary';

export default function AdminProjectsScreen(props: any) {
	return (
		<ErrorBoundary>
			<ProjectLifecycleScreen {...props} />
		</ErrorBoundary>
	);
}
