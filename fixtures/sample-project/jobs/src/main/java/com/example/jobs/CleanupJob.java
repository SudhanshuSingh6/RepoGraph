package com.example.jobs;

// Same package as BaseJob, so no import — BaseJob must still count as used.
public class CleanupJob extends BaseJob {
    @Override
    protected void execute() {}

    @Override
    protected String name() {
        return "cleanup";
    }
}
