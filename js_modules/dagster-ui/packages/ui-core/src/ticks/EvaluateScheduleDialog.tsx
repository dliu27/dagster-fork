import {
  Box,
  Button,
  Colors,
  Dialog,
  DialogBody,
  DialogFooter,
  Icon,
  Menu,
  MenuItem,
  Mono,
  NonIdealState,
  Popover,
  Spinner,
  Subheading,
  Tag,
  Tooltip,
  useViewport,
} from '@dagster-io/ui-components';
import {useCallback, useContext, useMemo, useRef, useState} from 'react';
import styled from 'styled-components';

import {RunRequestTable} from './DryRunRequestTable';
import {RUN_REQUEST_FRAGMENT} from './RunRequestFragment';
import {gql, useMutation, useQuery} from '../apollo-client';
import {
  GetScheduleQuery,
  GetScheduleQueryVariables,
  ScheduleDryRunMutation,
  ScheduleDryRunMutationVariables,
} from './types/EvaluateScheduleDialog.types';
import {showCustomAlert} from '../app/CustomAlertProvider';
import {PYTHON_ERROR_FRAGMENT} from '../app/PythonErrorFragment';
import {PythonErrorInfo} from '../app/PythonErrorInfo';
import {assertUnreachable} from '../app/Util';
import {TimeContext} from '../app/time/TimeContext';
import {timestampToString} from '../app/time/timestampToString';
import {PythonErrorFragment} from '../app/types/PythonErrorFragment.types';
import {ScheduleSelector} from '../graphql/types';
import {useLaunchMultipleRunsWithTelemetry} from '../launchpad/useLaunchMultipleRunsWithTelemetry';
import {testId} from '../testing/testId';
import {buildExecutionParamsListSchedule} from '../util/buildExecutionParamsList';
import {repoAddressToSelector} from '../workspace/repoAddressToSelector';
import {RepoAddress} from '../workspace/types';

export type ScheduleDryRunInstigationTick = Extract<
  ScheduleDryRunMutation['scheduleDryRun'],
  {__typename: 'DryRunInstigationTick'}
>;

const locale = navigator.language;

type Props = {
  repoAddress: RepoAddress;
  name: string;
  onClose: () => void;
  isOpen: boolean;
  jobName: string;
};

export const EvaluateScheduleDialog = (props: Props) => {
  return (
    <Dialog
      {...props}
      style={{width: '70vw', display: 'flex'}}
      title={
        <Box flex={{direction: 'row', gap: 8, alignItems: 'center'}}>
          <Icon name="schedule" />
          <span>{props.name}</span>
        </Box>
      }
    >
      <EvaluateSchedule {...props} />
    </Dialog>
  );
};

const EvaluateSchedule = ({repoAddress, name, onClose, jobName}: Props) => {
  const [selectedTimestamp, setSelectedTimestamp] = useState<{ts: number; label: string}>();
  const scheduleSelector: ScheduleSelector = useMemo(
    () => ({
      repositoryLocationName: repoAddress.location,
      repositoryName: repoAddress.name,
      scheduleName: name,
    }),
    [repoAddress, name],
  );

  // query to get the schedule initially
  const {data: getScheduleData} = useQuery<GetScheduleQuery, GetScheduleQueryVariables>(
    GET_SCHEDULE_QUERY,
    {
      variables: {
        scheduleSelector,
      },
    },
  );

  // mutation to evaluate the schedule
  const [scheduleDryRunMutation, {loading: scheduleDryRunMutationLoading}] = useMutation<
    ScheduleDryRunMutation,
    ScheduleDryRunMutationVariables
  >(SCHEDULE_DRY_RUN_MUTATION);

  // mutation to launch all runs
  const launchMultipleRunsWithTelemetry = useLaunchMultipleRunsWithTelemetry();

  const {
    timezone: [userTimezone],
  } = useContext(TimeContext);
  const [isTickSelectionOpen, setIsTickSelectionOpen] = useState<boolean>(false);
  const selectedTimestampRef = useRef<{ts: number; label: string} | null>(null);
  const {viewport, containerProps} = useViewport();
  const [launching, setLaunching] = useState(false);

  const [scheduleExecutionError, setScheduleExecutionError] = useState<PythonErrorFragment | null>(
    null,
  );
  const [scheduleExecutionData, setScheduleExecutionData] =
    useState<ScheduleDryRunInstigationTick | null>(null);

  const canSubmitTest = useMemo(() => {
    return getScheduleData && !scheduleDryRunMutationLoading;
  }, [getScheduleData, scheduleDryRunMutationLoading]);

  // handle clicking Evaluate button
  const submitTest = useCallback(async () => {
    if (!canSubmitTest) {
      return;
    }

    const repositorySelector = repoAddressToSelector(repoAddress);

    const result = await scheduleDryRunMutation({
      variables: {
        selectorData: {
          ...repositorySelector,
          scheduleName: name,
        },
        timestamp: selectedTimestampRef.current!.ts,
      },
    });

    const data = result.data?.scheduleDryRun;

    if (data) {
      if (data?.__typename === 'DryRunInstigationTick') {
        if (data.evaluationResult?.error) {
          setScheduleExecutionError(data.evaluationResult.error);
        } else {
          setScheduleExecutionData(data);
        }
      } else if (data?.__typename === 'ScheduleNotFoundError') {
        showCustomAlert({
          title: 'Schedule not found',
          body: `Could not find a schedule named: ${name}`,
        });
      } else {
        setScheduleExecutionError(data);
      }
    } else {
      assertUnreachable('scheduleDryRun Mutation returned no data??' as never);
    }
  }, [canSubmitTest, scheduleDryRunMutation, repoAddress, name]);

  const executionParamsList = useMemo(
    () =>
      scheduleExecutionData && scheduleSelector
        ? buildExecutionParamsListSchedule(scheduleExecutionData, scheduleSelector)
        : [],
    [scheduleSelector, scheduleExecutionData],
  );

  const canLaunchAll = useMemo(() => {
    return executionParamsList != null && executionParamsList.length > 0;
  }, [executionParamsList]);

  // handle clicking Launch all button
  const onLaunchAll = useCallback(async () => {
    if (!canLaunchAll) {
      return;
    }
    setLaunching(true);

    try {
      if (executionParamsList) {
        await launchMultipleRunsWithTelemetry({executionParamsList}, 'toast');
      }
    } catch (e) {
      console.error(e);
    }

    setLaunching(false);
    onClose();
  }, [canLaunchAll, executionParamsList, launchMultipleRunsWithTelemetry, onClose]);

  const content = useMemo(() => {
    // launching all runs state
    if (launching) {
      return (
        <Box flex={{direction: 'row', gap: 8, justifyContent: 'center', alignItems: 'center'}}>
          <Spinner purpose="body-text" />
          <div>Launching runs</div>
        </Box>
      );
    }

    // initial loading state when schedule data hasn't been queried yet
    if (!getScheduleData) {
      return (
        <Box padding={{vertical: 48}} flex={{alignItems: 'center', justifyContent: 'center'}}>
          <Spinner purpose="page" />
        </Box>
      );
    }

    // error states after getting schedule data
    if (getScheduleData.scheduleOrError.__typename === 'PythonError') {
      return <PythonErrorInfo error={getScheduleData.scheduleOrError} />;
    }

    if (getScheduleData.scheduleOrError.__typename === 'ScheduleNotFoundError') {
      return (
        <NonIdealState
          icon="error"
          title="Schedule not found"
          description={`Could not find a schedule named: ${name}`}
        />
      );
    }

    // handle showing results page after clicking Evaluate
    if (scheduleExecutionData || scheduleExecutionError) {
      return (
        <EvaluateScheduleResult
          repoAddress={repoAddress}
          name={name}
          timestamp={selectedTimestampRef.current!.ts}
          jobName={jobName}
          scheduleExecutionData={scheduleExecutionData}
          scheduleExecutionError={scheduleExecutionError}
        />
      );
    }

    // loading state for evaluating
    if (scheduleDryRunMutationLoading) {
      return (
        <Box flex={{direction: 'row', gap: 8, justifyContent: 'center', alignItems: 'center'}}>
          <Spinner purpose="body-text" />
          <div>Evaluating schedule</div>
        </Box>
      );
    } else {
      // tick selection page
      const timestamps = getScheduleData.scheduleOrError.potentialTickTimestamps.map((ts) => ({
        ts,
        label: timestampToString({
          timestamp: {unix: ts},
          locale,
          timezone: userTimezone,
          timeFormat: {
            showTimezone: true,
          },
        }),
      }));
      selectedTimestampRef.current = selectedTimestamp || timestamps[0] || null;
      return (
        <div>
          <ScheduleDescriptor>Select a mock evaluation time</ScheduleDescriptor>
          <Popover
            isOpen={isTickSelectionOpen}
            position="bottom-left"
            fill={true}
            content={
              <Menu style={{maxHeight: '400px', overflow: 'scroll', width: `${viewport.width}px`}}>
                {timestamps.map((timestamp) => (
                  <MenuItem
                    key={timestamp.ts}
                    text={<div data-testid={testId(`tick-${timestamp.ts}`)}>{timestamp.label}</div>}
                    onClick={() => {
                      setSelectedTimestamp(timestamp);
                      setIsTickSelectionOpen(false);
                    }}
                  />
                ))}
              </Menu>
            }
          >
            <div {...containerProps}>
              <Button
                style={{flex: 1, width: '100%'}}
                rightIcon={<Icon name="arrow_drop_down" />}
                onClick={() => setIsTickSelectionOpen((isOpen) => !isOpen)}
                data-testid={testId('tick-selection')}
              >
                {selectedTimestampRef.current?.label}
              </Button>
            </div>
          </Popover>
        </div>
      );
    }
  }, [
    launching,
    getScheduleData,
    scheduleExecutionData,
    scheduleExecutionError,
    scheduleDryRunMutationLoading,
    repoAddress,
    name,
    jobName,
    selectedTimestamp,
    isTickSelectionOpen,
    viewport.width,
    containerProps,
    userTimezone,
  ]);

  const buttons = useMemo(() => {
    if (launching) {
      return <Box flex={{direction: 'row', gap: 8}}></Box>;
    }

    if (scheduleExecutionData || scheduleExecutionError) {
      return (
        <Box flex={{direction: 'row', gap: 8}}>
          <Tooltip
            canShow={!canLaunchAll || launching}
            content="Preparing to launch runs"
            placement="top-end"
          >
            <Button disabled={!canLaunchAll || launching} onClick={onLaunchAll}>
              <div>Launch all</div>
            </Button>
          </Tooltip>

          <Button
            data-testid={testId('test-again')}
            onClick={() => {
              setScheduleExecutionData(null);
              setScheduleExecutionError(null);
            }}
          >
            Test again
          </Button>
          <Button intent="primary" onClick={onClose}>
            Close
          </Button>
        </Box>
      );
    }

    if (scheduleDryRunMutationLoading) {
      return (
        <Box flex={{direction: 'row', gap: 8}}>
          <Button onClick={onClose}>Cancel</Button>
        </Box>
      );
    } else {
      return (
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            data-testid={testId('evaluate')}
            intent="primary"
            disabled={!canSubmitTest}
            onClick={() => {
              submitTest();
            }}
          >
            Evaluate
          </Button>
        </>
      );
    }
  }, [
    canLaunchAll,
    canSubmitTest,
    launching,
    onClose,
    onLaunchAll,
    scheduleExecutionData,
    scheduleExecutionError,
    submitTest,
    scheduleDryRunMutationLoading,
  ]);

  return (
    <>
      <DialogBody>
        <div style={{minHeight: '300px'}}>{content}</div>
      </DialogBody>
      {buttons ? <DialogFooter topBorder>{buttons}</DialogFooter> : null}
    </>
  );
};

export const GET_SCHEDULE_QUERY = gql`
  query getSchedule(
    $scheduleSelector: ScheduleSelector!
    $startTimestamp: Float
    $ticksAfter: Int
    $ticksBefore: Int
  ) {
    scheduleOrError(scheduleSelector: $scheduleSelector) {
      ... on PythonError {
        message
        stack
      }
      ... on Schedule {
        id
        name
        potentialTickTimestamps(
          startTimestamp: $startTimestamp
          upperLimit: $ticksAfter
          lowerLimit: $ticksBefore
        )
      }
    }
  }
`;

// FE for showing result of evaluating schedule (error, skipped, or success state)
const EvaluateScheduleResult = ({
  repoAddress,
  name,
  timestamp,
  jobName,
  scheduleExecutionData,
  scheduleExecutionError,
}: {
  repoAddress: RepoAddress;
  name: string;
  timestamp: number;
  jobName: string;
  scheduleExecutionData: ScheduleDryRunInstigationTick | null;
  scheduleExecutionError: PythonErrorFragment | null;
}) => {
  const {
    timezone: [userTimezone],
  } = useContext(TimeContext);

  const evaluationResult = scheduleExecutionData?.evaluationResult;

  const innerContent = () => {
    if (scheduleExecutionError) {
      return <PythonErrorInfo error={scheduleExecutionError} />;
    }

    const data = scheduleExecutionData;
    if (!data || !evaluationResult) {
      return (
        <NonIdealState
          title="An unknown error occurred"
          description={
            <span>
              File an issue on{' '}
              <a href="https://github.com/dagster-io/dagster" target="_blank" rel="noreferrer">
                Github
              </a>{' '}
              if you think this is a bug
            </span>
          }
          icon="error"
        />
      );
    } else if (evaluationResult.error) {
      return <PythonErrorInfo error={evaluationResult.error} />;
    }
    if (!evaluationResult.runRequests?.length) {
      return (
        <div>
          <Subheading>Skip Reason</Subheading>
          <div>{evaluationResult?.skipReason || 'No skip reason was output'}</div>
        </div>
      );
    } else {
      return (
        <RunRequestTable
          runRequests={evaluationResult.runRequests}
          repoAddress={repoAddress}
          isJob={true}
          jobName={jobName}
          name={name}
        />
      );
    }
  };

  const numRunRequests = evaluationResult?.runRequests?.length;
  const error = scheduleExecutionError || evaluationResult?.error;

  return (
    <Box flex={{direction: 'column', gap: 8}}>
      <Box>
        <Grid>
          <div>
            <Subheading>Result</Subheading>
            <Box flex={{grow: 1, alignItems: 'center'}}>
              <div>
                {error ? (
                  <Tag intent="danger">Failed</Tag>
                ) : numRunRequests ? (
                  <Tag intent="success">{numRunRequests} run requests</Tag>
                ) : (
                  <Tag intent="warning">Skipped</Tag>
                )}
              </div>
            </Box>
          </div>
          <div>
            <Subheading>Tick</Subheading>
            <Box flex={{grow: 1, alignItems: 'center'}}>
              <Mono>
                {timestampToString({
                  timestamp: {unix: timestamp},
                  locale,
                  timezone: userTimezone,
                  timeFormat: {
                    showTimezone: true,
                  },
                })}
              </Mono>
            </Box>
          </div>
        </Grid>
      </Box>
      {innerContent()}
    </Box>
  );
};

export const SCHEDULE_DRY_RUN_MUTATION = gql`
  mutation ScheduleDryRunMutation($selectorData: ScheduleSelector!, $timestamp: Float) {
    scheduleDryRun(selectorData: $selectorData, timestamp: $timestamp) {
      ...PythonErrorFragment
      ... on DryRunInstigationTick {
        timestamp
        evaluationResult {
          runRequests {
            ...RunRequestFragment
          }
          skipReason
          error {
            ...PythonErrorFragment
          }
        }
      }
      ... on ScheduleNotFoundError {
        scheduleName
      }
    }
  }
  ${PYTHON_ERROR_FRAGMENT}
  ${RUN_REQUEST_FRAGMENT}
`;

const Grid = styled.div`
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  padding-bottom: 12px;
  border-bottom: 1px solid ${Colors.keylineDefault()};
  margin-bottom: 12px;
  ${Subheading} {
    padding-bottom: 4px;
    display: block;
  }
  pre {
    margin: 0;
  }
  button {
    margin-top: 4px;
  }
`;

const ScheduleDescriptor = styled.div`
  padding-bottom: 2px;
`;
