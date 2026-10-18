package com.example.jobs.model;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

@Entity
@Table(name = "orders")
public class Order {
    @Id
    private Long id;

    @Column
    private Long customerId;

    @Column
    private String status;

    public Long getId() {
        return id;
    }
}
